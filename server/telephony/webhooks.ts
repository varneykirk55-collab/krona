import twilio from 'twilio';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../db/database.js';
import type { Config } from '../config.js';
import type { TelephoneProvider } from './provider.js';
import { Store } from '../services/store.js';
import { Usage } from '../services/usage.js';
import { Scheduler } from '../services/scheduler.js';
import { assert } from '../errors.js';
import { randomToken, sha256, verifyPassword } from '../security.js';
const sid = z.string().regex(/^CA[0-9a-fA-F]{32}$/);
function fields(request: FastifyRequest): Record<string, string> {
  return z.record(z.string(), z.string().max(10000)).parse(request.body);
}
export function verifyTwilio(
  config: Config,
  request: Pick<FastifyRequest, 'headers' | 'raw'>,
  body: Record<string, string> = {},
  websocket = false,
) {
  const signature = request.headers['x-twilio-signature'];
  const url = config.publicBaseUrl + (request.raw.url || '');
  assert(
    config.twilioAuthToken &&
      typeof signature === 'string' &&
      (twilio.validateRequest(config.twilioAuthToken, signature, url, body) ||
        (websocket &&
          twilio.validateRequest(
            config.twilioAuthToken,
            signature,
            url.replace(/^http/, 'ws'),
            body,
          ))),
    403,
    'INVALID_TWILIO_SIGNATURE',
    'Invalid telephony request signature.',
  );
}
function unavailable() {
  const r = new twilio.twiml.VoiceResponse();
  r.say('The private assistant is unavailable right now. Please try again later.');
  r.hangup();
  return r.toString();
}
function gather(config: Config, intentId: string, retry = false) {
  const r = new twilio.twiml.VoiceResponse(),
    g = r.gather({
      input: ['dtmf'],
      action: `${config.publicBaseUrl}/twilio/pin?intent=${intentId}`,
      method: 'POST',
      finishOnKey: '#',
      timeout: 8,
      actionOnEmptyResult: true,
    });
  g.say(
    retry
      ? 'That PIN was not accepted. Enter your phone PIN followed by the pound key.'
      : 'This is Krona, your AI assistant. This call is not audio recorded. Enter your phone PIN followed by the pound key.',
  );
  r.hangup();
  return r.toString();
}
export function registerTelephony(
  app: FastifyInstance,
  db: Database,
  config: Config,
  phone: TelephoneProvider,
) {
  const signature = async (request: FastifyRequest) => {
    const body = fields(request);
    verifyTwilio(config, request, body);
    assert(
      body.AccountSid === config.twilioAccountSid,
      403,
      'WRONG_TWILIO_ACCOUNT',
      'This webhook is not from the configured Twilio account.',
    );
  };
  app.post(
    '/twilio/incoming',
    { preHandler: signature, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = fields(request),
        callSid = sid.parse(body.CallSid);
      if (!phone.available || !config.liveAI || !config.openaiApiKey)
        return reply.type('text/xml').send(unavailable());
      const owner = (await db.query('SELECT * FROM owners LIMIT 1')).rows[0];
      if (!owner) return reply.type('text/xml').send(unavailable());
      const settings = await new Store(db).settings(owner.id);
      if (
        !settings.phone_number ||
        body.From !== settings.phone_number ||
        body.To !== config.twilioPhoneNumber ||
        !owner.phone_pin_hash
      )
        return reply.type('text/xml').send(unavailable());
      try {
        const call = await db.transaction(async (tx) => {
          await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [owner.id]);
          const existing = (
            await tx.query('SELECT * FROM calls WHERE twilio_sid=$1 AND owner_id=$2', [
              callSid,
              owner.id,
            ])
          ).rows[0];
          if (existing) return existing;
          const check = await new Usage(tx, config).checkVoice(owner.id, true);
          const record = (
            await tx.query(
              "INSERT INTO calls(id,owner_id,twilio_sid,direction,status,reserved_cost_usd) VALUES($1,$2,$3,'inbound','ringing',$4) RETURNING *",
              [randomUUID(), owner.id, callSid, check.envelope],
            )
          ).rows[0];
          await new Store(tx).audit(owner.id, 'call.received', 'call', record.id);
          return record;
        });
        return reply.type('text/xml').send(gather(config, call.id));
      } catch {
        return reply.type('text/xml').send(unavailable());
      }
    },
  );
  app.post('/twilio/answer', { preHandler: signature }, async (request, reply) => {
    const body = fields(request),
      callSid = sid.parse(body.CallSid),
      intent = z.object({ intent: z.string().uuid() }).parse(request.query).intent;
    const call = (
      await db.query(
        "SELECT c.*,o.settings FROM calls c JOIN owners o ON o.id=c.owner_id WHERE c.id=$1 AND c.direction='outbound'",
        [intent],
      )
    ).rows[0];
    if (
      !phone.available ||
      !call ||
      call.settings.phone_number !== body.To ||
      body.From !== config.twilioPhoneNumber ||
      (call.twilio_sid && call.twilio_sid !== callSid) ||
      !['submitting', 'queued', 'ringing', 'in-progress', 'unknown'].includes(call.status)
    )
      return reply.type('text/xml').send(unavailable());
    await db.query(
      "UPDATE calls SET twilio_sid=COALESCE(twilio_sid,$1),status='in-progress',started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$2 AND (twilio_sid IS NULL OR twilio_sid=$1)",
      [callSid, intent],
    );
    return reply.type('text/xml').send(gather(config, intent));
  });
  app.post(
    '/twilio/pin',
    { preHandler: signature, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = fields(request),
        callSid = sid.parse(body.CallSid),
        intent = z.object({ intent: z.string().uuid() }).parse(request.query).intent;
      if (!phone.available) return reply.type('text/xml').send(unavailable());
      const call = (
        await db.query(
          'SELECT c.*,o.phone_pin_hash,o.settings FROM calls c JOIN owners o ON o.id=c.owner_id WHERE c.id=$1 AND c.twilio_sid=$2',
          [intent, callSid],
        )
      ).rows[0];
      if (
        !call?.phone_pin_hash ||
        (call.direction === 'inbound'
          ? body.From !== call.settings.phone_number || body.To !== config.twilioPhoneNumber
          : body.To !== call.settings.phone_number || body.From !== config.twilioPhoneNumber)
      )
        return reply.type('text/xml').send(unavailable());
      // Reserve an attempt atomically before the expensive password comparison.
      const attempt = await db.transaction(async (tx) => {
        await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [call.owner_id]);
        const total = (
          await tx.query(
            "SELECT COALESCE(sum(attempts),0)::int AS count FROM phone_auth_attempts WHERE owner_id=$1 AND created_at>now()-interval '1 day'",
            [call.owner_id],
          )
        ).rows[0].count;
        if (total >= 10) return null;
        const result = (
          await tx.query(
            'INSERT INTO phone_auth_attempts(call_sid,owner_id,attempts) VALUES($1,$2,1) ON CONFLICT(call_sid) DO UPDATE SET attempts=phone_auth_attempts.attempts+1 WHERE phone_auth_attempts.attempts<3 AND NOT phone_auth_attempts.passed RETURNING *',
            [callSid, call.owner_id],
          )
        ).rows[0];
        return result;
      });
      if (!attempt) return reply.type('text/xml').send(unavailable());
      const valid =
        /^\d{6,12}$/.test(body.Digits || '') &&
        (await verifyPassword(body.Digits, call.phone_pin_hash));
      if (!valid)
        return reply
          .type('text/xml')
          .send(attempt.attempts < 3 ? gather(config, intent, true) : unavailable());
      const token = randomToken();
      await db.transaction(async (tx) => {
        await tx.query('UPDATE phone_auth_attempts SET passed=true WHERE call_sid=$1', [callSid]);
        await tx.query('UPDATE owners SET phone_verified=true WHERE id=$1', [call.owner_id]);
        await tx.query(
          "UPDATE calls SET authenticated_at=now(),status='in-progress',started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1",
          [intent],
        );
        await tx.query(
          "INSERT INTO voice_tokens(token_hash,owner_id,call_id,call_sid,expires_at) VALUES($1,$2,$3,$4,now()+interval '60 seconds')",
          [sha256(token), call.owner_id, intent, callSid],
        );
        await new Store(tx).audit(call.owner_id, 'call.pin_authenticated', 'call', intent);
        await tx.query(
          "INSERT INTO system_meta(key,value) VALUES('telephony_verified',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",
          [JSON.stringify({ at: new Date().toISOString() })],
        );
      });
      const response = new twilio.twiml.VoiceResponse();
      const stream = response.connect().stream({
        url: config.publicBaseUrl.replace(/^http/, 'ws') + '/voice/media',
        statusCallback: `${config.publicBaseUrl}/twilio/stream-status?intent=${intent}`,
        statusCallbackMethod: 'POST',
      });
      stream.parameter({ name: 'token', value: token });
      response.hangup();
      return reply.type('text/xml').send(response.toString());
    },
  );
  app.post('/twilio/status', { preHandler: signature }, async (request, reply) => {
    const body = fields(request),
      callSid = sid.parse(body.CallSid),
      status = z
        .enum([
          'queued',
          'initiated',
          'ringing',
          'in-progress',
          'completed',
          'busy',
          'failed',
          'no-answer',
          'canceled',
        ])
        .parse(body.CallStatus);
    const query = request.query as any,
      seq = body.SequenceNumber
        ? z.coerce.number().int().min(0).max(2147483647).parse(body.SequenceNumber)
        : 0;
    const intent = query.intent ? z.string().uuid().parse(query.intent) : null;
    const terminal = ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status),
      duration =
        body.CallDuration && /^\d+$/.test(body.CallDuration)
          ? Math.min(Number(body.CallDuration), 86400)
          : null;
    let confirmedJob: any = null;
    await db.transaction(async (tx) => {
      const call = (
        await tx.query(
          'SELECT * FROM calls WHERE twilio_sid=$1 OR (id=$2::uuid AND twilio_sid IS NULL) FOR UPDATE',
          [callSid, intent],
        )
      ).rows[0];
      if (!call) return;
      const settings = await new Store(tx).settings(call.owner_id);
      if (
        call.direction === 'outbound'
          ? body.To !== settings.phone_number || body.From !== config.twilioPhoneNumber
          : body.From !== settings.phone_number || body.To !== config.twilioPhoneNumber
      )
        return;
      const key = sha256(`${callSid}:${status}:${seq}`),
        inserted = await tx.query(
          'INSERT INTO webhook_events(event_key,call_id,owner_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_key',
          [key, call.id, call.owner_id],
        );
      if (!inserted.rows.length) return;
      const wasTerminal = ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(
        call.status,
      );
      if (seq < call.last_status_sequence || (wasTerminal && status !== call.status)) return;
      const knownDuration = duration ?? (terminal && status !== 'completed' ? 0 : null),
        estimate =
          knownDuration === null
            ? null
            : (knownDuration / 60) * ((config.twilioRate || 0) + (config.aiVoiceRate || 0));
      await tx.query(
        `UPDATE calls SET twilio_sid=COALESCE(twilio_sid,$1),status=$2,last_status_sequence=$3,
        duration_seconds=COALESCE($4,duration_seconds),estimated_cost_usd=COALESCE($5,estimated_cost_usd),
        started_at=CASE WHEN $2='in-progress' THEN COALESCE(started_at,now()) ELSE started_at END,
        ended_at=CASE WHEN $6 THEN COALESCE(ended_at,now()) ELSE ended_at END,
        outcome=CASE WHEN $6 THEN CASE WHEN authenticated_at IS NOT NULL THEN $2 ELSE 'not_authenticated' END ELSE outcome END,updated_at=now() WHERE id=$7`,
        [callSid, status, seq, knownDuration, estimate, terminal, call.id],
      );
      if (call.job_id)
        confirmedJob = (
          await tx.query(
            "SELECT * FROM scheduled_jobs WHERE id=$1 AND owner_id=$2 AND status='unknown'",
            [call.job_id, call.owner_id],
          )
        ).rows[0];
      if (terminal && !wasTerminal) {
        await new Store(tx).audit(call.owner_id, 'call.ended', 'call', call.id, { status });
        if (call.conversation_id)
          await tx.query(
            "UPDATE conversations SET status='ended',ended_at=COALESCE(ended_at,now()) WHERE id=$1 AND owner_id=$2",
            [call.conversation_id, call.owner_id],
          );
      }
    });
    if (confirmedJob)
      await new Scheduler(db, config, phone).finalize(
        confirmedJob,
        new Date(),
        'completed',
        'signed_callback_confirmed_dispatch',
      );
    return reply.code(204).send();
  });
  app.post('/twilio/stream-status', { preHandler: signature }, async (request, reply) => {
    const body = fields(request),
      intent = z.object({ intent: z.string().uuid() }).parse(request.query).intent;
    if (body.StreamEvent === 'stream-error')
      await db.query(
        "UPDATE calls SET outcome='Audio stream error; inspect provider diagnostics',updated_at=now() WHERE id=$1 AND twilio_sid=$2",
        [intent, body.CallSid],
      );
    return reply.code(204).send();
  });
}
