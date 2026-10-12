import type { Schedule } from '../../shared/schemas.js';
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.js';
import type { Config } from '../config.js';
import type { TelephoneProvider } from '../telephony/provider.js';
import { isDefinitiveRejection } from '../telephony/provider.js';
import { Store } from './store.js';
import { Usage } from './usage.js';
import { dayBounds, iso, nextAllowedTime, nextOccurrence } from './time.js';
import { AppError, assert } from '../errors.js';
export class Scheduler {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private db: Database,
    private config: Config,
    private phone: TelephoneProvider,
  ) {}
  start() {
    if (!this.config.schedulerEnabled || this.timer) return;
    this.timer = setInterval(
      () => void this.tick().catch(() => {}),
      this.config.schedulerIntervalMs,
    );
    this.timer.unref();
    void this.tick().catch(() => {});
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  async heartbeat(state: string, detail: string) {
    await this.db.query(
      "INSERT INTO system_meta(key,value) VALUES('scheduler',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",
      [JSON.stringify({ state, detail, at: new Date().toISOString() })],
    );
  }
  async recover(now: Date) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE calls SET status='unknown',outcome='Dispatch interrupted; manual reconciliation required',updated_at=now() WHERE job_id IN (SELECT id FROM scheduled_jobs WHERE status='dispatching' AND lease_until<$1) AND status IN ('reserved','submitting')",
        [now.toISOString()],
      );
      await tx.query(
        "UPDATE scheduled_jobs SET status='unknown',last_error='dispatch_interrupted_no_retry',updated_at=now() WHERE status='dispatching' AND lease_until<$1",
        [now.toISOString()],
      );
      await tx.query(
        "UPDATE scheduled_jobs SET status=CASE WHEN attempts>=2 THEN 'failed' ELSE 'pending' END,attempts=attempts+1,last_error='claim_lease_expired',updated_at=now() WHERE status='claimed' AND lease_until<$1",
        [now.toISOString()],
      );
    });
  }
  async claim(now: Date) {
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query(
          `SELECT j.* FROM scheduled_jobs j JOIN schedules s ON s.id=j.schedule_id
      WHERE j.status IN ('pending','blocked') AND j.run_at<=$1 AND s.enabled AND s.version=j.schedule_version
      ORDER BY j.run_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
          [now.toISOString()],
        )
      ).rows[0];
      if (!row) return null;
      await tx.query(
        "UPDATE scheduled_jobs SET status='claimed',lease_until=$1,updated_at=now() WHERE id=$2",
        [new Date(now.getTime() + 90000).toISOString(), row.id],
      );
      return row;
    });
  }
  async defer(tx: Database, id: string, until: string, reason: string, blocked = false) {
    await tx.query(
      `UPDATE scheduled_jobs SET status=$1,run_at=$2,last_error=$3,lease_until=NULL,updated_at=now() WHERE id=$4`,
      [blocked ? 'blocked' : 'pending', until, reason, id],
    );
  }
  async finalize(job: any, now: Date, status = 'completed', error: string | null = null) {
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [job.owner_id]);
      const s = new Store(tx),
        schedule = await s.owned('schedules', job.owner_id, job.schedule_id, true);
      await tx.query(
        'UPDATE scheduled_jobs SET status=$1,last_error=$2,lease_until=NULL,updated_at=now() WHERE id=$3',
        [status, error, job.id],
      );
      if (schedule.version !== job.schedule_version || !schedule.enabled) return;
      const after = new Date(Math.max(now.getTime(), new Date(job.occurrence_at).getTime()));
      const next = nextOccurrence(schedule, after);
      if (next) {
        const updated = (
          await tx.query<Schedule>(
            'UPDATE schedules SET next_run_at=$1,updated_at=now() WHERE id=$2 RETURNING *',
            [next, schedule.id],
          )
        ).rows[0];
        await s.enqueue(updated);
      } else
        await tx.query('UPDATE schedules SET enabled=false,updated_at=now() WHERE id=$1', [
          schedule.id,
        ]);
    });
  }
  async dispatch(job: any, now: Date) {
    let intent: any = null;
    try {
      intent = await this.db.transaction(async (tx) => {
        // Lock the owner before budget checks. All paid dispatches share this serialization point.
        const owner = (
          await tx.query('SELECT * FROM owners WHERE id=$1 FOR UPDATE', [job.owner_id])
        ).rows[0];
        if (!owner) return null;
        const current = (
          await tx.query('SELECT * FROM scheduled_jobs WHERE id=$1 FOR UPDATE', [job.id])
        ).rows[0];
        const schedule = (
          await tx.query('SELECT * FROM schedules WHERE id=$1 FOR UPDATE', [job.schedule_id])
        ).rows[0];
        if (
          current?.status !== 'claimed' ||
          !schedule?.enabled ||
          schedule.version !== job.schedule_version
        ) {
          await tx.query(
            "UPDATE scheduled_jobs SET status='canceled' WHERE id=$1 AND status='claimed'",
            [job.id],
          );
          return null;
        }
        const store = new Store(tx),
          settings = await store.settings(job.owner_id);
        if (
          !settings.outbound_enabled ||
          !owner.outbound_consent_at ||
          !settings.phone_number ||
          !owner.phone_verified ||
          !owner.phone_pin_hash
        ) {
          await this.defer(
            tx,
            job.id,
            new Date(now.getTime() + 15 * 60000).toISOString(),
            'owner_consent_or_phone_verification_required',
            true,
          );
          return null;
        }
        if (!this.phone.available || !this.config.liveAI || !this.config.openaiApiKey) {
          await this.defer(
            tx,
            job.id,
            new Date(now.getTime() + 5 * 60000).toISOString(),
            'live_provider_configuration_required',
            true,
          );
          return null;
        }
        const allowed = nextAllowedTime(now, settings);
        if (new Date(allowed).getTime() > now.getTime()) {
          await this.defer(tx, job.id, allowed, 'quiet_hours_or_pause');
          return null;
        }
        const u = new Usage(tx, this.config),
          daily = await u.daily(job.owner_id, now);
        if (daily.outbound_calls >= settings.daily_call_limit) {
          const tomorrow = dayBounds(now, settings.timezone).end;
          await this.defer(
            tx,
            job.id,
            nextAllowedTime(new Date(tomorrow), settings),
            'daily_call_limit',
            true,
          );
          return null;
        }
        const check = await u.checkVoice(job.owner_id, true);
        const id = randomUUID();
        const call = (
          await tx.query(
            "INSERT INTO calls(id,owner_id,job_id,schedule_id,direction,status,reserved_cost_usd) VALUES($1,$2,$3,$4,'outbound','submitting',$5) RETURNING *",
            [id, job.owner_id, job.id, schedule.id, check.envelope],
          )
        ).rows[0];
        await tx.query(
          "UPDATE scheduled_jobs SET status='dispatching',lease_until=$1,attempts=attempts+1,updated_at=now() WHERE id=$2",
          [new Date(now.getTime() + 90000).toISOString(), job.id],
        );
        await store.audit(job.owner_id, 'call.dispatch_reserved', 'call', id, {
          direction: 'outbound',
        });
        return {
          ...call,
          phone: settings.phone_number,
          maxSeconds: settings.max_call_minutes * 60,
        };
      });
      if (!intent) return;
      const placed = await this.phone.placeOwnerCall({
        phone: intent.phone,
        intentId: intent.id,
        maxSeconds: intent.maxSeconds,
      });
      // A signed answer/status webhook can have attached the SID before create returns.
      await this.db.query(
        "UPDATE calls SET twilio_sid=COALESCE(twilio_sid,$1),status=CASE WHEN status IN ('reserved','submitting') THEN $2 ELSE status END,updated_at=now() WHERE id=$3 AND (twilio_sid IS NULL OR twilio_sid=$1)",
        [placed.sid, placed.status, intent.id],
      );
      await this.finalize(job, now);
    } catch (e) {
      if (intent) {
        if (isDefinitiveRejection(e)) {
          await this.db.query(
            "UPDATE calls SET status='failed',estimated_cost_usd=0,outcome='Provider rejected call creation; no retry',updated_at=now() WHERE id=$1",
            [intent.id],
          );
          await this.finalize(job, now, 'failed', 'provider_rejected_no_retry');
        } else {
          // Twilio call creation does not provide an application-controlled idempotency key.
          // A timeout could mean a call was created: NEVER retry this uncertain real-world side effect.
          const confirmed = await this.db.transaction(async (tx) => {
            const current = (
              await tx.query('SELECT * FROM calls WHERE id=$1 FOR UPDATE', [intent.id])
            ).rows[0];
            if (current?.twilio_sid) return true;
            await tx.query(
              "UPDATE calls SET status='unknown',outcome='Creation outcome unknown; check provider console before reconciling',updated_at=now() WHERE id=$1",
              [intent.id],
            );
            await tx.query(
              "UPDATE scheduled_jobs SET status='unknown',last_error='provider_outcome_unknown_no_retry',updated_at=now() WHERE id=$1",
              [job.id],
            );
            return false;
          });
          if (confirmed)
            await this.finalize(job, now, 'completed', 'signed_callback_confirmed_dispatch');
        }
      } else {
        const reason = e instanceof AppError ? e.code : 'scheduler_preflight_failure';
        await this.db
          .query(
            "UPDATE scheduled_jobs SET status=CASE WHEN attempts>=2 THEN 'failed' ELSE 'blocked' END,attempts=attempts+1,run_at=$1,last_error=$2,lease_until=NULL,updated_at=now() WHERE id=$3 AND status='claimed'",
            [
              new Date(now.getTime() + 60000 * 2 ** Math.min(job.attempts || 0, 3)).toISOString(),
              reason,
              job.id,
            ],
          )
          .catch(() => {});
      }
    }
  }
  async tick(now = new Date()) {
    if (this.running) return { processed: 0, busy: true };
    this.running = true;
    let processed = 0;
    try {
      await this.recover(now);
      for (let i = 0; i < 20; i++) {
        const job = await this.claim(now);
        if (!job) break;
        if (now.getTime() - new Date(job.occurrence_at).getTime() > 24 * 3600000) {
          await this.finalize(job, now, 'failed', 'stale_occurrence_skipped');
          processed++;
          continue;
        }
        await this.dispatch(job, now);
        processed++;
      }
      await this.heartbeat(
        'healthy',
        'Worker tick completed; blocked jobs never simulate telephone calls.',
      );
      return { processed, busy: false };
    } catch (e) {
      await this.heartbeat(
        'degraded',
        'Database or worker failure; inspect structured error codes.',
      ).catch(() => {});
      throw e;
    } finally {
      this.running = false;
    }
  }
  async reconcile(
    ownerId: string,
    callId: string,
    input: { sid?: string; confirm_not_placed?: boolean },
  ) {
    const store = new Store(this.db),
      call = await store.owned('calls', ownerId, callId);
    assert(
      call.status === 'unknown',
      409,
      'NOT_UNRESOLVED',
      'This call is not awaiting reconciliation.',
    );
    if (input.sid) {
      assert(
        /^CA[0-9a-fA-F]{32}$/.test(input.sid),
        400,
        'INVALID_SID',
        'Enter the actual Twilio call SID.',
      );
      const actual = await this.phone.lookupCall(input.sid),
        settings = await store.settings(ownerId);
      assert(
        actual.to === settings.phone_number && actual.from === this.config.twilioPhoneNumber,
        403,
        'WRONG_CALL',
        'This provider call does not match your owner phone and provisioned assistant number.',
      );
      const estimate =
        actual.duration === null
          ? null
          : (actual.duration / 60) *
            ((this.config.twilioRate || 0) + (this.config.aiVoiceRate || 0));
      await this.db.query(
        'UPDATE calls SET twilio_sid=$1,status=$2,duration_seconds=$3,estimated_cost_usd=$4,outcome=$5,updated_at=now() WHERE id=$6 AND owner_id=$7',
        [
          actual.sid,
          actual.status,
          actual.duration,
          estimate,
          'Manually reconciled against provider',
          callId,
          ownerId,
        ],
      );
    } else {
      assert(
        input.confirm_not_placed,
        400,
        'MANUAL_VERIFICATION_REQUIRED',
        'Confirm from your provider console that no call was created.',
      );
      await this.db.query(
        "UPDATE calls SET status='failed',estimated_cost_usd=0,outcome='Owner manually verified no call was placed',updated_at=now() WHERE id=$1 AND owner_id=$2",
        [callId, ownerId],
      );
    }
    if (call.job_id) {
      const job = (
        await this.db.query('SELECT * FROM scheduled_jobs WHERE id=$1 AND owner_id=$2', [
          call.job_id,
          ownerId,
        ])
      ).rows[0];
      if (job) await this.finalize(job, new Date(), 'completed', 'manually_reconciled');
    }
    await store.audit(ownerId, 'call.reconciled', 'call', callId);
    return store.owned('calls', ownerId, callId);
  }
}
