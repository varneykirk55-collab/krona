import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { fixture } from './helpers.js';
import { ConversationEngine } from '../server/ai/conversation.js';
import { executeTool } from '../server/ai/tools.js';
import { Actions, scopeHash } from '../server/services/actions.js';
import { ScriptedAI, tool, text } from './fakes.js';
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  f.config.aiInputRate = 1;
  f.config.aiOutputRate = 2;
  const s = await f.store.settings(f.owner.id);
  s.daily_ai_token_limit = 1000000;
  await f.db.query('UPDATE owners SET settings=$1::jsonb WHERE id=$2', [
    JSON.stringify(s),
    f.owner.id,
  ]);
});
afterAll(async () => f.close());
describe('Conversation orchestration with explicitly MOCKED AI and real DB/tool transactions', () => {
  it('creates a task through an actual tool call and returns persisted confirmation', async () => {
    const ai = new ScriptedAI((_r, i) =>
      i === 0
        ? tool('create_task', { title: 'Call dentist tomorrow', due_at: '2026-10-13T13:00:00Z' })
        : text('Mock confirmation: task saved.'),
    );
    const engine = new ConversationEngine(f.db, f.config, ai);
    const r = await engine.message(f.owner.id, {
      message: 'Remind me to call the dentist tomorrow',
    });
    expect(r.tools[0].result.ok).toBe(true);
    expect(
      (await f.store.listTasks(f.owner.id)).some((t) => t.title === 'Call dentist tomorrow'),
    ).toBe(true);
    expect(ai.requests[0].instructions).toContain('Never agree merely to please');
  });
  it('recovers relevant memory in a different conversation rather than replaying all history', async () => {
    const first = await f.store.createConversation(f.owner.id, 'text');
    await f.store.createMemory(
      f.owner.id,
      { content: 'The website checkout needs a Stripe integration', category: 'projects' },
      first.id,
    );
    await f.db.query("UPDATE conversations SET status='ended' WHERE id=$1", [first.id]);
    const ai = new ScriptedAI((r) => {
      expect(r.instructions).toContain('website checkout needs a Stripe');
      expect(r.input.length).toBeLessThan(14);
      return text('Mock retrieval verified.');
    });
    const engine = new ConversationEngine(f.db, f.config, ai);
    const response = await engine.message(f.owner.id, {
      message: 'Where did we leave off on website checkout?',
    });
    expect(response.conversation_id).not.toBe(first.id);
  });
  it('does not falsely roll back or hide successful tool changes when AI fails afterward', async () => {
    const ai = new ScriptedAI((_r, i) => {
      if (i === 0)
        return tool(
          'create_task',
          { title: 'Persist despite provider failure' },
          'call_failure_task',
        );
      throw new Error('MOCK provider unavailable');
    });
    const r = await new ConversationEngine(f.db, f.config, ai).message(f.owner.id, {
      message: 'Create this task',
    });
    expect(r.provider_failure).toBe(true);
    expect(r.text).toContain('did complete and are stored');
    expect(
      (await f.store.listTasks(f.owner.id)).some(
        (t) => t.title === 'Persist despite provider failure',
      ),
    ).toBe(true);
  });
  it('replays the same tool ID idempotently and rejects different arguments', async () => {
    const c = await f.store.createConversation(f.owner.id, 'text'),
      ctx = {
        ownerId: f.owner.id,
        conversationId: c.id,
        channel: 'text' as const,
        assurance: 'dashboard' as const,
      };
    const a: any = await executeTool(
      f.db,
      ctx,
      'create_task',
      { title: 'Only once' },
      'call_idempotent',
    );
    const b: any = await executeTool(
      f.db,
      ctx,
      'create_task',
      { title: 'Only once' },
      'call_idempotent',
    );
    expect(a.data.id).toBe(b.data.id);
    await expect(
      executeTool(f.db, ctx, 'create_task', { title: 'Different action' }, 'call_idempotent'),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('denies unverified telephone tool access even with a known owner ID', async () => {
    const c = await f.store.createConversation(f.owner.id, 'phone');
    await expect(
      executeTool(
        f.db,
        { ownerId: f.owner.id, conversationId: c.id, channel: 'phone', assurance: 'none' },
        'search_memory',
        { query: 'website' },
        'call_unauthorized',
      ),
    ).rejects.toMatchObject({ code: 'CALLER_AUTH_REQUIRED' });
  });
  it('honors pause today, week, daily limit and project stop commands in actual records', async () => {
    const c = await f.store.createConversation(f.owner.id, 'phone'),
      ctx = {
        ownerId: f.owner.id,
        conversationId: c.id,
        channel: 'phone' as const,
        assurance: 'phone_pin' as const,
      };
    await executeTool(
      f.db,
      ctx,
      'checkin_control',
      { operation: 'pause_today' },
      'call_pause_today',
    );
    expect((await f.store.settings(f.owner.id)).paused_until).toBeTruthy();
    await executeTool(f.db, ctx, 'checkin_control', { operation: 'pause_week' }, 'call_pause_week');
    expect(
      new Date((await f.store.settings(f.owner.id)).paused_until!).getTime() - Date.now(),
    ).toBeGreaterThan(6 * 86400000);
    await executeTool(
      f.db,
      ctx,
      'checkin_control',
      { operation: 'limit_daily', daily_limit: 1 },
      'call_limit',
    );
    expect((await f.store.settings(f.owner.id)).daily_call_limit).toBe(1);
    const p = await f.store.createProject(f.owner.id, { name: 'Stop this project' }),
      schedule = await f.store.createSchedule(f.owner.id, {
        title: 'Project follow-up',
        project_id: p.id,
        next_run_at: '2026-10-13T13:00:00Z',
      });
    await executeTool(
      f.db,
      ctx,
      'checkin_control',
      { operation: 'cancel_project', project_id: p.id },
      'call_project_stop',
    );
    expect((await f.store.owned('schedules', f.owner.id, schedule.id)).enabled).toBe(false);
    expect((await f.store.settings(f.owner.id)).outbound_enabled).toBe(false);
  });
  it('prevents the model from labeling its memory as confirmed fact', async () => {
    const c = await f.store.createConversation(f.owner.id, 'text');
    await expect(
      executeTool(
        f.db,
        { ownerId: f.owner.id, conversationId: c.id, channel: 'text', assurance: 'dashboard' },
        'remember',
        { content: 'Speculative claim', confidence: 'confirmed' },
        'call_memory_fake',
      ),
    ).rejects.toBeTruthy();
  });
});
describe('Risk classification and authorization framework', () => {
  it('executes low-risk internal notes once, with a real stored result', async () => {
    const service = new Actions(f.db),
      p = await service.propose(f.owner.id, {
        kind: 'note.create',
        title: 'Internal note',
        payload: { content: 'An authorized internal test note' },
      });
    const a = await service.execute(f.owner.id, p.id),
      b = await service.execute(f.owner.id, p.id);
    expect(a.result.memory_id).toBe(b.result.memory_id);
    expect(a.status).toBe('completed');
  });
  it('rejects approval of altered scope and phone approval', async () => {
    const service = new Actions(f.db),
      p = await service.propose(f.owner.id, {
        kind: 'message.send',
        title: 'Test proposal',
        payload: { recipient: 'test@example.test', body: 'Test' },
      });
    await expect(
      service.approve(
        f.owner.id,
        p.id,
        scopeHash('message.send', { recipient: 'other', body: 'changed' }),
        { channel: 'dashboard', reauthenticated: false, explicitHighImpact: false },
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
    await expect(
      service.approve(f.owner.id, p.id, p.scope_hash, {
        channel: 'phone',
        reauthenticated: true,
        explicitHighImpact: true,
      }),
    ).rejects.toMatchObject({ code: 'DASHBOARD_APPROVAL_REQUIRED' });
  });
});
