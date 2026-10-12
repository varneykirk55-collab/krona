import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import twilio from 'twilio';
import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import { fixture } from './helpers.js';
import { buildApp } from '../server/app.js';
import { updateSettings } from '../server/services/preferences.js';
import { MockTelephone, MockRealtime, ScriptedAI } from './fakes.js';
let f: Awaited<ReturnType<typeof fixture>>,
  service: Awaited<ReturnType<typeof buildApp>>,
  realTime: MockRealtime | null = null,
  port: number;
const testSid = 'CA' + randomBytes(16).toString('hex'),
  streamSid = 'MZ' + randomBytes(16).toString('hex');
let callId: string, token: string;
beforeAll(async () => {
  f = await fixture();
  Object.assign(f.config, {
    liveAI: true,
    liveCalls: true,
    openaiApiKey: 'MOCK-NOT-A-CREDENTIAL',
    twilioAuthToken: 'MOCK-TWILIO-SIGNATURE-TEST-SECRET',
    twilioPhoneNumber: '+12125550102',
    twilioAccountSid: 'AC' + randomBytes(16).toString('hex'),
    publicBaseUrl: 'https://assistant.example.test',
    twilioRate: 0.01,
    aiVoiceRate: 0.01,
  });
  await f.auth.setPhonePin(f.owner.id, 'secure-test-password-123', '749218');
  await updateSettings(f.db, f.owner.id, { phone_number: '+12125550101' });
  service = await buildApp({
    db: f.db,
    config: f.config,
    phone: new MockTelephone(),
    ai: new ScriptedAI(),
    logger: false,
    realtimeFactory: (_c, _s, callbacks) => (realTime = new MockRealtime(callbacks)),
  });
  await service.app.listen({ port: 0, host: '127.0.0.1' });
  port = (service.app.server.address() as any).port;
});
afterAll(async () => {
  await service.app.close();
  await f.close();
});
function post(url: string, body: Record<string, string>) {
  const signature = twilio.getExpectedTwilioSignature(
    f.config.twilioAuthToken!,
    f.config.publicBaseUrl + url,
    body,
  );
  return service.app.inject({
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature,
    },
    payload: new URLSearchParams(body).toString(),
  });
}
const ownerBody = () => ({
  AccountSid: f.config.twilioAccountSid!,
  CallSid: testSid,
  From: '+12125550101',
  To: '+12125550102',
});
describe('Twilio signature, caller auth, WebSocket and status integration with MOCK AI/telephone', () => {
  it('rejects unsigned or incorrectly signed webhooks', async () => {
    const r = await service.app.inject({
      method: 'POST',
      url: '/twilio/incoming',
      payload: ownerBody(),
    });
    expect(r.statusCode).toBe(403);
    expect((await f.store.listCalls(f.owner.id)).length).toBe(0);
  });
  it('rejects unknown callers even when the provider signature is valid', async () => {
    const r = await post('/twilio/incoming', { ...ownerBody(), From: '+12125550999' });
    expect(r.body).toContain('<Hangup');
    expect((await f.store.listCalls(f.owner.id)).length).toBe(0);
  });
  it('requires a PIN after a signed known-caller request, with no private context yet', async () => {
    const r = await post('/twilio/incoming', ownerBody());
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<Gather');
    expect(r.body).not.toContain('<Stream');
    callId = (await f.store.listCalls(f.owner.id))[0].id;
    expect((await f.store.listConversations(f.owner.id)).length).toBe(0);
    await post('/twilio/incoming', ownerBody());
    expect((await f.store.listCalls(f.owner.id)).length).toBe(1);
  });
  it('does not accept a wrong PIN or expose memory', async () => {
    const r = await post('/twilio/pin?intent=' + callId, { ...ownerBody(), Digits: '000000' });
    expect(r.body).not.toContain('<Stream');
    expect(realTime).toBeNull();
    expect((await f.store.listConversations(f.owner.id)).length).toBe(0);
  });
  it('authenticates an actual hashed PIN and creates a short-lived stream token', async () => {
    const r = await post('/twilio/pin?intent=' + callId, { ...ownerBody(), Digits: '749218' });
    expect(r.body).toContain('<Stream');
    token = r.body.match(/name="token" value="([^"]+)"/)![1];
    expect(
      (await f.db.query('SELECT phone_verified FROM owners WHERE id=$1', [f.owner.id])).rows[0]
        .phone_verified,
    ).toBe(true);
    expect((await f.db.query('SELECT token_hash FROM voice_tokens')).rows[0].token_hash).not.toBe(
      token,
    );
  });
  it('requires a signed upgrade and consumes the token before opening MOCK AI', async () => {
    const signature = twilio.getExpectedTwilioSignature(
        f.config.twilioAuthToken!,
        f.config.publicBaseUrl + '/voice/media',
        {},
      ),
      ws = new WebSocket(`ws://127.0.0.1:${port}/voice/media`, {
        headers: { 'x-twilio-signature': signature },
      });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const events: any[] = [];
    ws.on('message', (m) => events.push(JSON.parse(m.toString())));
    ws.send(
      JSON.stringify({
        event: 'start',
        start: {
          callSid: testSid,
          streamSid,
          customParameters: { token },
          mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
        },
      }),
    );
    await expect.poll(() => !!realTime).toBe(true);
    const payload = Buffer.alloc(160, 42).toString('base64');
    ws.send(JSON.stringify({ event: 'media', streamSid, media: { timestamp: '1000', payload } }));
    await expect.poll(() => realTime!.audio.length).toBe(1);
    expect(realTime!.audio[0]).toBe(payload);
    realTime!.callbacks.audio(Buffer.alloc(8000, 41).toString('base64'), 'assistant_audio_test');
    await expect.poll(() => events.some((e) => e.event === 'mark')).toBe(true);
    ws.send(JSON.stringify({ event: 'media', streamSid, media: { timestamp: '1250', payload } }));
    await expect.poll(() => realTime!.audio.length).toBe(2);
    realTime!.callbacks.speechStarted();
    await expect.poll(() => events.some((e) => e.event === 'clear')).toBe(true);
    expect(realTime!.interruptions[0].ms).toBe(250);
    ws.send(JSON.stringify({ event: 'stop', streamSid }));
    await new Promise<void>((r) => ws.once('close', () => r()));
    expect(
      (await f.db.query('SELECT consumed_at FROM voice_tokens')).rows[0].consumed_at,
    ).toBeTruthy();
    const replay = new WebSocket(`ws://127.0.0.1:${port}/voice/media`, {
      headers: { 'x-twilio-signature': signature },
    });
    await new Promise<void>((r) => replay.once('open', r));
    replay.send(
      JSON.stringify({
        event: 'start',
        start: {
          callSid: testSid,
          streamSid,
          customParameters: { token },
          mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
        },
      }),
    );
    const code = await new Promise<number>((r) => replay.once('close', (code) => r(code)));
    expect(code).toBe(1008);
  });
  it('applies call status once, ignores late regressions and records actual callback duration', async () => {
    const body = {
      ...ownerBody(),
      CallStatus: 'completed',
      SequenceNumber: '3',
      CallDuration: '60',
    };
    await post('/twilio/status', body);
    await post('/twilio/status', body);
    await post('/twilio/status', { ...ownerBody(), CallStatus: 'ringing', SequenceNumber: '1' });
    const call = await f.store.owned('calls', f.owner.id, callId);
    expect(call.status).toBe('completed');
    expect(call.duration_seconds).toBe(60);
    expect(
      (await f.db.query('SELECT * FROM webhook_events WHERE call_id=$1', [callId])).rows,
    ).toHaveLength(2);
    expect(
      (
        await f.db.query("SELECT * FROM audit_logs WHERE entity_id=$1 AND action='call.ended'", [
          callId,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it('rejects a valid signature for the wrong provider account', async () => {
    const r = await post('/twilio/incoming', {
      ...ownerBody(),
      AccountSid: 'AC' + randomBytes(16).toString('hex'),
    });
    expect(r.statusCode).toBe(403);
  });
  it('a callback cannot attach a foreign telephone identity to an unresolved intent', async () => {
    const schedule = await f.store.createSchedule(f.owner.id, {
        title: 'Identity regression',
        next_run_at: new Date().toISOString(),
      }),
      job = (await f.db.query('SELECT * FROM scheduled_jobs WHERE schedule_id=$1', [schedule.id]))
        .rows[0];
    const id = (
      await f.db.query(
        "INSERT INTO calls(id,owner_id,job_id,schedule_id,direction,status) VALUES(gen_random_uuid(),$1,$2,$3,'outbound','unknown') RETURNING id",
        [f.owner.id, job.id, schedule.id],
      )
    ).rows[0].id;
    await f.db.query("UPDATE scheduled_jobs SET status='unknown' WHERE id=$1", [job.id]);
    const callSid = 'CA' + randomBytes(16).toString('hex');
    await post('/twilio/status?intent=' + id, {
      ...ownerBody(),
      CallSid: callSid,
      From: '+12125550102',
      To: '+12125550999',
      CallStatus: 'completed',
      SequenceNumber: '3',
      CallDuration: '60',
    });
    expect((await f.store.owned('calls', f.owner.id, id)).twilio_sid).toBeNull();
    await post('/twilio/status?intent=' + id, {
      ...ownerBody(),
      CallSid: callSid,
      From: '+12125550102',
      To: '+12125550101',
      CallStatus: 'completed',
      SequenceNumber: '3',
      CallDuration: '60',
    });
    expect((await f.store.owned('calls', f.owner.id, id)).status).toBe('completed');
    expect(
      (await f.db.query('SELECT status FROM scheduled_jobs WHERE id=$1', [job.id])).rows[0].status,
    ).toBe('completed');
    expect((await f.store.owned('schedules', f.owner.id, schedule.id)).enabled).toBe(false);
  });
  it('accepts the canonical WSS signature but still refuses a stream without one-use PIN authorization', async () => {
    const signature = twilio.getExpectedTwilioSignature(
        f.config.twilioAuthToken!,
        f.config.publicBaseUrl.replace('https:', 'wss:') + '/voice/media',
        {},
      ),
      socket = new WebSocket(`ws://127.0.0.1:${port}/voice/media`, {
        headers: { 'x-twilio-signature': signature },
      });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
    socket.send(
      JSON.stringify({
        event: 'start',
        start: {
          callSid: testSid,
          streamSid,
          customParameters: {},
          mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
        },
      }),
    );
    expect(await closed).toBe(1008);
  });
});
