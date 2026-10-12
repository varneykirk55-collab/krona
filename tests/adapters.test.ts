import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { TwilioProvider, isDefinitiveRejection } from '../server/telephony/provider.js';
import { OpenAIProvider } from '../server/ai/provider.js';
import { OpenAIRealtime, realtimeSession } from '../server/ai/realtime.js';
import { loadConfig } from '../server/config.js';
import { settingsSchema } from '../shared/schemas.js';
const config = () => ({
  ...loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: '/home/user/krona/.data/adapter-test-config',
    SESSION_SECRET: 'adapter-test-secret-'.repeat(3),
    SETUP_TOKEN: 'adapter-test-token-'.repeat(3),
  }),
  liveAI: true,
  openaiApiKey: 'MOCK-ADAPTER-ONLY-NOT-A-CREDENTIAL',
});
afterEach(() => vi.restoreAllMocks());
describe('Actual provider adapter contracts with mocked HTTP/WebSocket transports', () => {
  it('sends the real Responses API contract with store=false and automatic retries disabled', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp_mock',
          object: 'response',
          status: 'completed',
          output: [
            {
              type: 'message',
              id: 'msg_mock',
              role: 'assistant',
              status: 'completed',
              content: [
                { type: 'output_text', text: 'Mocked transport response', annotations: [] },
              ],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    const p = new OpenAIProvider(config());
    const r = await p.complete({
      instructions: 'Test',
      input: [{ role: 'user', content: 'Test input' }],
      tools: [],
      maxOutputTokens: 300,
    });
    expect(r.text).toBe('Mocked transport response');
    const request = fetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(request.body as string);
    expect(body.store).toBe(false);
    expect(body.model).toBe('gpt-4.1-mini');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('gracefully rejects provider HTTP errors without retrying paid requests', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'Mocked failure', type: 'server_error' } }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        ),
      );
    await expect(
      new OpenAIProvider(config()).complete({
        instructions: 'Test',
        input: [],
        tools: [],
        maxOutputTokens: 100,
      }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('negotiates GA realtime audio, serializes tool results and suppresses canceled audio', async () => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((r) => server.once('listening', r));
    const port = (server.address() as any).port,
      events: any[] = [],
      audio: string[] = [],
      c = config();
    let remote: WebSocket;
    let ready = false;
    server.on('connection', (ws) => {
      remote = ws;
      ws.on('message', (raw) => {
        const e = JSON.parse(raw.toString());
        events.push(e);
        if (e.type === 'session.update')
          ws.send(JSON.stringify({ type: 'session.updated', session: e.session }));
      });
    });
    const realtime = new OpenAIRealtime(
      c,
      realtimeSession(c, settingsSchema.parse({}), 'Test', 'phone'),
      {
        ready: () => {
          ready = true;
        },
        audio: (p) => audio.push(p),
        speechStarted: () => realtime.interrupt('item_mock', 120),
        transcript: () => {},
        tool: async () => ({ ok: true, data: { persisted: 'MOCK TEST ONLY' } }),
        usage: async () => true,
        failure: () => {},
      },
      {
        socketFactory: (url, opts) => {
          expect(url).toContain('api.openai.com/v1/realtime?model=');
          expect(opts.headers.Authorization).toContain('Bearer');
          return new WebSocket(`ws://127.0.0.1:${port}`);
        },
      },
    );
    try {
      realtime.connect();
      await expect.poll(() => ready).toBe(true);
      expect(events[0].session.audio.input.format).toEqual({ type: 'audio/pcmu' });
      realtime.appendAudio('AAAA');
      await expect
        .poll(() => events.some((e) => e.type === 'input_audio_buffer.append'))
        .toBe(true);
      remote!.send(JSON.stringify({ type: 'response.created', response: { id: 'resp_audio' } }));
      remote!.send(
        JSON.stringify({
          type: 'response.output_audio.delta',
          response_id: 'resp_audio',
          item_id: 'item_mock',
          delta: 'AAAA',
        }),
      );
      await expect.poll(() => audio.length).toBe(1);
      remote!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
      await expect
        .poll(() => events.some((e) => e.type === 'conversation.item.truncate'))
        .toBe(true);
      remote!.send(
        JSON.stringify({
          type: 'response.output_audio.delta',
          response_id: 'resp_audio',
          item_id: 'item_mock',
          delta: 'BBBB',
        }),
      );
      remote!.send(JSON.stringify({ type: 'response.created', response: { id: 'resp_tool' } }));
      remote!.send(
        JSON.stringify({
          type: 'response.function_call_arguments.done',
          response_id: 'resp_tool',
          name: 'create_task',
          arguments: '{}',
          call_id: 'call_mock',
        }),
      );
      remote!.send(
        JSON.stringify({
          type: 'response.done',
          response: {
            id: 'resp_tool',
            status: 'completed',
            output: [{ type: 'function_call' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }),
      );
      await expect.poll(() => events.some((e) => e.type === 'response.create')).toBe(true);
      expect(audio).toEqual(['AAAA']);
      const output = events.find((e) => e.item?.type === 'function_call_output');
      expect(JSON.parse(output.item.output).ok).toBe(true);
      expect(events.indexOf(output)).toBeLessThan(
        events.findIndex((e) => e.type === 'response.create'),
      );
    } finally {
      realtime.close();
      for (const ws of server.clients) ws.terminate();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
  it('uses actual Twilio SDK parameters, forbids disabled creation but permits protective termination', async () => {
    const c = {
        ...config(),
        liveCalls: true,
        twilioAccountSid: 'AC' + '1'.repeat(32),
        twilioAuthToken: 'MOCK-TRANSPORT-ONLY-NOT-A-CREDENTIAL',
        twilioPhoneNumber: '+12125550102',
      },
      p = new TwilioProvider(c),
      client = (p as any).client,
      http = client.httpClient;
    const sid = 'CA' + '2'.repeat(32);
    const request = vi.spyOn(http, 'request').mockResolvedValue({
      statusCode: 201,
      body: JSON.stringify({
        sid,
        status: 'queued',
        to: '+12125550101',
        from: c.twilioPhoneNumber,
      }),
      headers: {},
    });
    expect(http.autoRetry).toBe(false);
    expect(http.defaultTimeout).toBe(15000);
    await p.placeOwnerCall({ phone: '+12125550101', intentId: 'MOCK_INTENT', maxSeconds: 600 });
    const options = request.mock.calls[0][0] as any;
    expect(options.data).toMatchObject({
      To: '+12125550101',
      From: c.twilioPhoneNumber,
      TimeLimit: 600,
      Timeout: 25,
      Record: 'false',
    });
    expect(options.data.Url).toContain('/twilio/answer?intent=MOCK_INTENT');
    c.liveCalls = false;
    await expect(
      p.placeOwnerCall({ phone: '+12125550101', intentId: 'MOCK_INTENT', maxSeconds: 600 }),
    ).rejects.toMatchObject({ code: 'TELEPHONY_NOT_CONFIGURED' });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ sid, status: 'completed' }),
      headers: {},
    });
    await p.endCall(sid);
    expect((request.mock.calls[1][0] as any).data.Status).toBe('completed');
    expect(isDefinitiveRejection({ status: 408 })).toBe(false);
    expect(isDefinitiveRejection({ status: 409 })).toBe(false);
    expect(isDefinitiveRejection({ status: 400 })).toBe(true);
  });
});
