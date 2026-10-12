import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.js';
import type { Config } from '../config.js';
import { assert } from '../errors.js';
import { Store } from './store.js';
import { dayBounds } from './time.js';
export class Usage {
  constructor(
    public db: Database,
    public config: Config,
  ) {}
  async daily(ownerId: string, now = new Date()) {
    const settings = await new Store(this.db).settings(ownerId),
      bounds = dayBounds(now, settings.timezone);
    const u = (
      await this.db.query(
        `SELECT count(*) FILTER(WHERE kind IN ('text_ai_request','summary_ai_request','embedding_ai_request','voice_ai_response'))::int AS ai_requests,
      COALESCE(sum(input_tokens+output_tokens),0)::bigint AS ai_tokens,
      COALESCE(sum(estimated_cost_usd) FILTER(WHERE kind IN ('text_ai_request','summary_ai_request','embedding_ai_request')),0)::numeric AS ai_cost,
      COALESCE(sum(seconds),0)::int AS voice_seconds FROM usage_events WHERE owner_id=$1 AND created_at >= $2 AND created_at < $3`,
        [ownerId, bounds.start, bounds.end],
      )
    ).rows[0];
    const c = (
      await this.db.query(
        `SELECT count(*) FILTER(WHERE direction='outbound')::int AS outbound_calls,
      count(*) FILTER(WHERE status IN ('reserved','submitting','queued','ringing','in-progress','unknown'))::int AS active_calls,
      COALESCE(sum(CASE WHEN status IN ('reserved','submitting','queued','ringing','in-progress','unknown') THEN reserved_cost_usd ELSE COALESCE(estimated_cost_usd,reserved_cost_usd) END),0)::numeric AS cost,
      COALESCE(sum(duration_seconds),0)::int AS telephone_seconds FROM calls WHERE owner_id=$1 AND created_at >= $2 AND created_at < $3`,
        [ownerId, bounds.start, bounds.end],
      )
    ).rows[0];
    const b = (
      await this.db.query(
        `SELECT count(*) FILTER(WHERE status IN ('starting','active','unknown'))::int AS active_sessions,
      COALESCE(sum(reserved_cost_usd),0)::numeric AS cost FROM browser_voice_sessions WHERE owner_id=$1 AND created_at >= $2 AND created_at < $3`,
        [ownerId, bounds.start, bounds.end],
      )
    ).rows[0];
    // Check all-day concurrency too: a call crossing midnight still consumes a concurrent slot.
    const active = (
      await this.db.query(
        "SELECT count(*)::int AS count FROM (SELECT id FROM calls WHERE owner_id=$1 AND status IN ('reserved','submitting','queued','ringing','in-progress','unknown') UNION ALL SELECT id FROM browser_voice_sessions WHERE owner_id=$1 AND status IN ('starting','active','unknown')) a",
        [ownerId],
      )
    ).rows[0].count;
    return {
      ai_requests: Number(u.ai_requests),
      ai_tokens: Number(u.ai_tokens),
      outbound_calls: Number(c.outbound_calls),
      active_calls: Number(active),
      telephone_minutes: Number(c.telephone_seconds) / 60,
      voice_minutes: Number(u.voice_seconds) / 60,
      estimated_cost_usd: Number(u.ai_cost) + Number(c.cost) + Number(b.cost),
      pricing_configured: !!(
        this.config.twilioRate &&
        this.config.aiVoiceRate &&
        this.config.aiInputRate &&
        this.config.aiOutputRate
      ),
      day_start: bounds.start,
      day_end: bounds.end,
    };
  }
  async reserveText(
    ownerId: string,
    conversationId: string | null,
    inputTokenEnvelope: number,
    maxOutputTokens: number,
    kind = 'text_ai_request',
  ) {
    assert(
      this.config.aiInputRate && this.config.aiOutputRate,
      503,
      'PRICING_REQUIRED',
      'Set AI_INPUT_USD_PER_MILLION and AI_OUTPUT_USD_PER_MILLION before enabling paid AI requests.',
    );
    const cost =
      (inputTokenEnvelope * this.config.aiInputRate + maxOutputTokens * this.config.aiOutputRate) /
      1000000;
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
      const service = new Usage(tx, this.config),
        s = await new Store(tx).settings(ownerId),
        d = await service.daily(ownerId);
      assert(
        d.ai_requests < s.daily_ai_request_limit &&
          d.ai_tokens + inputTokenEnvelope + maxOutputTokens <= s.daily_ai_token_limit,
        429,
        'AI_LIMIT_REACHED',
        'Your daily AI request or token limit has been reached.',
      );
      assert(
        d.estimated_cost_usd + cost <= s.daily_spend_limit_usd,
        429,
        'SPEND_LIMIT_REACHED',
        'This request exceeds your estimated daily spending limit.',
      );
      const id = randomUUID();
      await tx.query(
        'INSERT INTO usage_events(id,owner_id,conversation_id,kind,input_tokens,output_tokens,estimated_cost_usd,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [
          id,
          ownerId,
          conversationId,
          kind,
          inputTokenEnvelope,
          maxOutputTokens,
          cost,
          JSON.stringify({ state: 'reserved', estimate: true }),
        ],
      );
      return id;
    });
  }
  async settleText(id: string, input: number, output: number, provider: string) {
    const cost =
      this.config.aiInputRate && this.config.aiOutputRate
        ? (input * this.config.aiInputRate + output * this.config.aiOutputRate) / 1000000
        : null;
    await this.db.query(
      'UPDATE usage_events SET input_tokens=$1,output_tokens=$2,estimated_cost_usd=$3,detail=$4::jsonb WHERE id=$5',
      [input, output, cost, JSON.stringify({ state: 'completed', provider, estimate: true }), id],
    );
  }
  async recordRealtime(
    ownerId: string,
    conversationId: string,
    responseId: string,
    input: number,
    output: number,
    details: unknown,
  ) {
    await this.db.query(
      "INSERT INTO usage_events(id,owner_id,conversation_id,kind,input_tokens,output_tokens,detail) VALUES($1,$2,$3,'voice_ai_response',$4,$5,$6::jsonb) ON CONFLICT DO NOTHING",
      [
        randomUUID(),
        ownerId,
        conversationId,
        input,
        output,
        JSON.stringify({ provider_response_id: responseId, token_details: details }),
      ],
    );
    const d = await this.daily(ownerId),
      s = await new Store(this.db).settings(ownerId);
    return d.ai_requests < s.daily_ai_request_limit && d.ai_tokens < s.daily_ai_token_limit;
  }
  async recordVoiceDuration(
    ownerId: string,
    conversationId: string,
    seconds: number,
    callId: string | null = null,
  ) {
    await this.db.query(
      'INSERT INTO usage_events(id,owner_id,conversation_id,call_id,kind,seconds,detail) VALUES($1,$2,$3,$4,\'voice_session\',$5,\'{"source":"backend-session-clock","estimate":true}\'::jsonb) ON CONFLICT DO NOTHING',
      [
        randomUUID(),
        ownerId,
        conversationId,
        callId,
        Math.max(0, Math.min(86400, Math.round(seconds))),
      ],
    );
  }
  voiceEnvelope(minutes: number, telephone = true): number {
    assert(
      this.config.aiVoiceRate && (!telephone || this.config.twilioRate),
      503,
      'PRICING_REQUIRED',
      'Configure conservative telephone and AI voice cost estimates before live voice sessions.',
    );
    return minutes * (this.config.aiVoiceRate! + (telephone ? this.config.twilioRate! : 0));
  }
  async checkVoice(ownerId: string, telephone: boolean) {
    const s = await new Store(this.db).settings(ownerId),
      daily = await this.daily(ownerId),
      envelope = this.voiceEnvelope(s.max_call_minutes, telephone);
    assert(
      daily.active_calls < s.concurrent_call_limit,
      429,
      'CONCURRENT_CALL_LIMIT',
      'Your concurrent voice-session limit has been reached.',
    );
    assert(
      daily.ai_requests < s.daily_ai_request_limit && daily.ai_tokens < s.daily_ai_token_limit,
      429,
      'AI_LIMIT_REACHED',
      'Your daily AI usage limit has been reached.',
    );
    assert(
      daily.estimated_cost_usd + envelope <= s.daily_spend_limit_usd,
      429,
      'SPEND_LIMIT_REACHED',
      'This call exceeds your conservative estimated daily spending limit.',
    );
    return { settings: s, daily, envelope };
  }
}
