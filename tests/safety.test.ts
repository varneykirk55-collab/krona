import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { updateSettings } from '../server/services/preferences.js';
import { boundToolData } from '../server/ai/bounds.js';
import { buildApp } from '../server/app.js';
import { fixture } from './helpers.js';
import { containsCredentials, redactCredentials } from '../server/services/privacy.js';
import { connectDatabase } from '../server/db/database.js';
import { ConversationEngine } from '../server/ai/conversation.js';
import { BrowserVoice } from '../server/ai/browserVoice.js';
import { ScriptedAI } from './fakes.js';
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => (f = await fixture()));
afterAll(async () => {
  vi.restoreAllMocks();
  await f.close();
});
describe('Privacy, recovery and continuity regression tests', () => {
  it('prevents a second embedded process/engine opening the same data directory', async () => {
    await expect(connectDatabase(f.config)).rejects.toThrow('already in use');
  });
  it('rejects recognizable credentials before memory storage or external AI transmission', async () => {
    expect(containsCredentials('My phone PIN is 749218')).toBe(true);
    expect(redactCredentials('My password is secret-1234')).not.toContain('secret-1234');
    await expect(
      f.store.createMemory(f.owner.id, { content: 'My phone PIN is 749218' }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_CONTENT_REJECTED' });
    const ai = new ScriptedAI();
    await expect(
      new ConversationEngine(f.db, f.config, ai).message(f.owner.id, {
        message: 'My password is private-passphrase',
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_CONTENT_REJECTED' });
    expect(ai.requests).toHaveLength(0);
  });
  it('links multiple real conversations to project/task continuity and cascades deletion', async () => {
    const c = await f.store.createConversation(f.owner.id, 'text'),
      p = await f.store.createProject(f.owner.id, { name: 'Linked project' }, c.id),
      t = await f.store.createTask(f.owner.id, { title: 'Linked task', project_id: p.id }, c.id),
      c2 = await f.store.createConversation(f.owner.id, 'phone');
    await f.store.updateTask(f.owner.id, t.id, { notes: 'Actual owner update' }, c2.id);
    const context = await f.store.projectContext(f.owner.id, p.id);
    expect(context.conversations.map((x: any) => x.id)).toContain(c2.id);
    expect(
      (await f.db.query('SELECT * FROM task_conversations WHERE task_id=$1', [t.id])).rows,
    ).toHaveLength(2);
    await f.store.deleteConversation(f.owner.id, c2.id);
    expect(
      (await f.db.query('SELECT * FROM task_conversations WHERE conversation_id=$1', [c2.id])).rows,
    ).toHaveLength(0);
  });
  it('does not claim browser provider termination succeeded on a mocked HTTP failure', async () => {
    const c = await f.store.createConversation(f.owner.id, 'browser'),
      id = randomUUID();
    await f.db.query(
      "INSERT INTO browser_voice_sessions(id,owner_id,conversation_id,provider_call_id,status,reserved_cost_usd) VALUES($1,$2,$3,'rtc_MOCK_TEST_ONLY','active',1)",
      [id, f.owner.id, c.id],
    );
    f.config.openaiApiKey = 'MOCK-NOT-A-CREDENTIAL';
    const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Mock termination failure' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const voice = new BrowserVoice(
      f.db,
      f.config,
      new ConversationEngine(f.db, f.config, new ScriptedAI()),
    );
    await expect(voice.end(f.owner.id, id)).rejects.toMatchObject({
      code: 'VOICE_TERMINATION_UNKNOWN',
    });
    expect((await voice.list(f.owner.id))[0].status).toBe('unknown');
    await voice.reconcile(f.owner.id, id, 'I VERIFIED NO ACTIVE VOICE SESSION');
    const row = (await f.db.query('SELECT * FROM browser_voice_sessions WHERE id=$1', [id]))
      .rows[0];
    expect(row.status).toBe('ended');
    expect(Number(row.reserved_cost_usd)).toBe(1);
    expect(transport).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
  it('prevents deleting active/unresolved voice tracking via conversation or account erasure', async () => {
    const c = await f.store.createConversation(f.owner.id, 'browser'),
      id = randomUUID();
    await f.db.query(
      "INSERT INTO browser_voice_sessions(id,owner_id,conversation_id,status) VALUES($1,$2,$3,'unknown')",
      [id, f.owner.id, c.id],
    );
    await expect(f.store.deleteConversation(f.owner.id, c.id)).rejects.toMatchObject({
      code: 'ACTIVE_SESSION',
    });
    await expect(
      f.auth.eraseAccount(f.owner.id, 'secure-test-password-123', 'DELETE ALL PERSONAL DATA'),
    ).rejects.toMatchObject({ code: 'ACTIVE_SESSION' });
    await f.db.query("UPDATE browser_voice_sessions SET status='ended' WHERE id=$1", [id]);
    await f.store.deleteConversation(f.owner.id, c.id);
  });
  it('applies priority filtering before pagination across the full persisted task set', async () => {
    await f.store.createTask(f.owner.id, { title: 'Only urgent record', priority: 'urgent' });
    for (let i = 0; i < 52; i++)
      await f.store.createTask(f.owner.id, { title: 'Low record ' + i, priority: 'low' });
    const urgent = await f.store.listTasks(f.owner.id, { priority: 'urgent', limit: 1 });
    expect(urgent).toHaveLength(1);
    expect(urgent[0].priority).toBe('urgent');
  });

  it('filters memory categories before paging and does not expose secret/vector fields to models', async () => {
    await f.store.createMemory(f.owner.id, {
      content: 'Remember this routine',
      category: 'routines',
    });
    const records = await f.store.listMemories(f.owner.id, '', 1, 'routines', 0);
    expect(records[0].category).toBe('routines');
    expect(await f.store.listMemories(f.owner.id, '', 1, 'routines', 1)).toHaveLength(0);
    const bounded = boundToolData(
      Array.from({ length: 50 }, () => ({
        title: 'Title',
        notes: 'x'.repeat(10000),
        embedding: Array(1536).fill(0.5),
      })),
    );
    expect(JSON.stringify(bounded.data).length).toBeLessThanOrEqual(24000);
    expect(JSON.stringify(bounded.data)).not.toContain('embedding');
    expect(bounded.truncated_for_model).toBe(true);
  });
  it('retention preserves unresolved sessions while deleting actual expired conversation rows', async () => {
    const c = await f.store.createConversation(f.owner.id, 'browser'),
      plain = await f.store.createConversation(f.owner.id, 'text'),
      id = randomUUID();
    await f.db.query(
      "INSERT INTO browser_voice_sessions(id,owner_id,conversation_id,status) VALUES($1,$2,$3,'unknown')",
      [id, f.owner.id, c.id],
    );
    await f.db.query(
      "UPDATE conversations SET last_activity_at=now()-interval '200 days' WHERE id IN ($1,$2)",
      [c.id, plain.id],
    );
    const deleted = await f.store.retention();
    expect(deleted.map((x: any) => x.id)).toContain(plain.id);
    expect((await f.store.getConversation(f.owner.id, c.id)).id).toBe(c.id);
    await f.db.query("UPDATE browser_voice_sessions SET status='ended' WHERE id=$1", [id]);
    await f.store.deleteConversation(f.owner.id, c.id);
  });
  it('requires HTTPS in production, emits secure strict cookies behind a trusted TLS proxy', async () => {
    const config = {
        ...f.config,
        nodeEnv: 'production',
        trustProxy: true,
        publicBaseUrl: 'https://companion.example.test',
        dashboardOrigin: 'https://companion.example.test',
      },
      service = await buildApp({ db: f.db, config, logger: false, ai: new ScriptedAI() });
    try {
      const insecure = await service.app.inject({ method: 'GET', url: '/api/auth/status' });
      expect(insecure.statusCode).toBe(400);
      const login = await service.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: config.dashboardOrigin, 'x-forwarded-proto': 'https' },
        payload: { email: 'owner@example.test', password: 'secure-test-password-123' },
      });
      expect(login.statusCode).toBe(200);
      const cookie = login.headers['set-cookie'] as string;
      expect(cookie).toContain('__Host-krona=');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).not.toContain('Partitioned');
    } finally {
      await service.app.close();
    }
  });

  it('does not reinsert a transcript when retention is disabled during an in-flight save', async () => {
    const c = await f.store.createConversation(f.owner.id, 'text');
    await updateSettings(f.db, f.owner.id, { retain_transcripts: true });
    await Promise.all([
      f.store.saveMessage(f.owner.id, c.id, 'user', 'Synthetic test transcript only'),
      updateSettings(f.db, f.owner.id, { retain_transcripts: false }),
    ]);
    expect((await f.store.getConversation(f.owner.id, c.id)).messages).toHaveLength(0);
  });
});
