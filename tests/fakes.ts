// Deliberately test-only adapters. NEVER imported by the application server.
import { randomBytes } from 'node:crypto';
import type { TelephoneProvider } from '../server/telephony/provider.js';
import type { ConversationProvider, AIResult, CompletionRequest } from '../server/ai/provider.js';
import type { RealtimeCallbacks, RealtimeConnection } from '../server/ai/realtime.js';
export class MockTelephone implements TelephoneProvider {
  name = 'mock-test-only';
  available = true;
  placed: { phone: string; intentId: string; maxSeconds: number }[] = [];
  ended: string[] = [];
  failure: Error | null = null;
  async placeOwnerCall(input: { phone: string; intentId: string; maxSeconds: number }) {
    this.placed.push(input);
    if (this.failure) throw this.failure;
    return { sid: 'CA' + randomBytes(16).toString('hex'), status: 'queued' };
  }
  async endCall(sid: string) {
    this.ended.push(sid);
  }
  async replaceWithMessage(sid: string, _message: string) {
    this.ended.push(sid);
  }
  async lookupCall(sid: string) {
    return { sid, status: 'completed', to: '+12125550101', from: '+12125550102', duration: 60 };
  }
}
export class ScriptedAI implements ConversationProvider {
  name = 'mock-ai-test-only';
  available = true;
  requests: CompletionRequest[] = [];
  constructor(
    private script: (
      request: CompletionRequest,
      index: number,
    ) => AIResult | Promise<AIResult> = () => text('Mock test response'),
  ) {}
  async complete(request: CompletionRequest) {
    this.requests.push(request);
    if (request.instructions.startsWith('Summarize'))
      return text('Mock test summary, not a live AI result.');
    return this.script(
      request,
      this.requests.filter((r) => !r.instructions.startsWith('Summarize')).length - 1,
    );
  }
}
export function text(value: string): AIResult {
  return {
    output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: value }] },
    ],
    text: value,
    inputTokens: 100,
    outputTokens: 20,
  };
}
export function tool(name: string, args: unknown, id = 'call_test_1'): AIResult {
  return {
    output: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }],
    text: '',
    inputTokens: 100,
    outputTokens: 40,
  };
}
export class MockRealtime implements RealtimeConnection {
  audio: string[] = [];
  interruptions: { itemId: string | null; ms: number }[] = [];
  closed = false;
  constructor(public callbacks: RealtimeCallbacks) {}
  connect() {
    this.callbacks.ready();
  }
  appendAudio(payload: string) {
    this.audio.push(payload);
  }
  interrupt(itemId: string | null, ms: number) {
    this.interruptions.push({ itemId, ms });
  }
  say(_instructions: string) {}
  close() {
    this.closed = true;
  }
}
