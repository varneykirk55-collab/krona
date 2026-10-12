import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.js';
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f.close();
});
describe('Real PostgreSQL-backed persistence (embedded engine, no mocked SQL)', () => {
  it('creates tasks, updates status and persists completion time', async () => {
    const task = await f.store.createTask(f.owner.id, { title: 'Call the dentist' });
    expect(task.status).toBe('not_started');
    const done = await f.store.updateTask(f.owner.id, task.id, {
      status: 'completed',
      notes: 'Booked for next week',
    });
    expect(done.completed_at).toBeTruthy();
    expect((await f.store.getTask(f.owner.id, task.id)).notes).toBe('Booked for next week');
  });
  it('enforces ownership for records and foreign keys', async () => {
    const p = await f.store.createProject(f.owner.id, { name: 'Website' });
    await expect(
      f.store.createTask(randomUUID(), { title: 'Unauthorized', project_id: p.id }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.store.updateProject(randomUUID(), p.id, { name: 'Hijacked' }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('stores memory, deduplicates it and preserves confidence', async () => {
    const m = await f.store.createMemory(f.owner.id, {
      content: 'I prefer concise answers',
      category: 'preferences',
      confidence: 'user_provided',
    });
    const again = await f.store.createMemory(f.owner.id, {
      content: 'I   prefer concise answers',
      category: 'preferences',
    });
    expect(again.id).toBe(m.id);
    expect(again.deduplicated).toBe(true);
    expect((await f.store.retrieveMemory(f.owner.id, 'concise'))[0].confidence).toBe(
      'user_provided',
    );
  });
  it('flags contradictions instead of silently replacing facts', async () => {
    const a = await f.store.createMemory(f.owner.id, {
      content: 'My preferred check-in time is 9 AM',
      subject: 'check-in time',
    });
    const b = await f.store.createMemory(f.owner.id, {
      content: 'My preferred check-in time is 3 PM',
      subject: 'check-in time',
    });
    expect(b.confidence).toBe('conflicted');
    expect((await f.store.owned('memories', f.owner.id, a.id)).confidence).toBe('conflicted');
    await f.store.updateMemory(f.owner.id, b.id, { confidence: 'confirmed' });
    expect((await f.store.owned('memories', f.owner.id, a.id)).confidence).toBe('outdated');
  });
  it('excludes sensitive and disabled memory categories from retrieval', async () => {
    const secret = await f.store.createMemory(f.owner.id, {
      content: 'Private account information',
      sensitive: true,
    });
    expect(
      (await f.store.retrieveMemory(f.owner.id, 'Private account')).some((m) => m.id === secret.id),
    ).toBe(false);
    expect(
      (await f.store.retrieveMemory(f.owner.id, 'Private account', true)).some(
        (m) => m.id === secret.id,
      ),
    ).toBe(true);
    const settings = await f.store.settings(f.owner.id);
    settings.disabled_memory_categories = ['routines'];
    await f.db.query('UPDATE owners SET settings=$1::jsonb WHERE id=$2', [
      JSON.stringify(settings),
      f.owner.id,
    ]);
    await expect(
      f.store.createMemory(f.owner.id, { content: 'Routine', category: 'routines' }),
    ).rejects.toMatchObject({ code: 'MEMORY_DISABLED' });
  });
  it('deletes the actual stored memory rather than hiding it', async () => {
    const m = await f.store.createMemory(f.owner.id, { content: 'Delete this test note' });
    await f.store.deleteMemory(f.owner.id, m.id);
    expect((await f.db.query('SELECT id FROM memories WHERE id=$1', [m.id])).rows).toHaveLength(0);
  });
  it('prevents dependency cycles and premature completion', async () => {
    const a = await f.store.createTask(f.owner.id, { title: 'First' }),
      b = await f.store.createTask(f.owner.id, { title: 'Second', dependencies: [a.id] });
    await expect(
      f.store.updateTask(f.owner.id, a.id, { dependencies: [b.id] }),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_CYCLE' });
    await expect(
      f.store.updateTask(f.owner.id, b.id, { status: 'completed' }),
    ).rejects.toMatchObject({ code: 'UNFINISHED_DEPENDENCIES' });
    await f.store.updateTask(f.owner.id, a.id, { status: 'completed' });
    expect((await f.store.updateTask(f.owner.id, b.id, { status: 'completed' })).status).toBe(
      'completed',
    );
  });
  it('creates a recurring task exactly once on completion', async () => {
    const a = await f.store.createTask(f.owner.id, {
      title: 'Daily planning',
      due_at: '2026-10-12T13:00:00Z',
      recurrence: { frequency: 'daily', timezone: 'America/New_York', interval: 1 },
    });
    const done = await f.store.updateTask(f.owner.id, a.id, { status: 'completed' });
    expect(done.next_instance_id).toBeTruthy();
    expect((await f.store.getTask(f.owner.id, done.next_instance_id!)).due_at).toBe(
      '2026-10-13T13:00:00.000Z',
    );
    expect(
      (await f.store.updateTask(f.owner.id, a.id, { status: 'completed' })).next_instance_id,
    ).toBe(done.next_instance_id);
  });
  it('reschedules by invalidating the original durable job', async () => {
    const s = await f.store.createSchedule(f.owner.id, {
      title: 'Morning check-in',
      next_run_at: '2026-10-13T13:00:00Z',
    });
    const updated = await f.store.updateSchedule(f.owner.id, s.id, {
      next_run_at: '2026-10-14T13:00:00Z',
    });
    const jobs = (
      await f.db.query(
        'SELECT * FROM scheduled_jobs WHERE schedule_id=$1 ORDER BY schedule_version',
        [s.id],
      )
    ).rows;
    expect(jobs).toHaveLength(2);
    expect(jobs[0].status).toBe('canceled');
    expect(jobs[1].status).toBe('pending');
    expect(updated.version).toBe(2);
  });
  it('persists memory and conversation summaries across engine restart', async () => {
    const c = await f.store.createConversation(f.owner.id, 'text');
    await f.store.createMemory(
      f.owner.id,
      { content: 'The website payment integration is unfinished', category: 'projects' },
      c.id,
    );
    await f.db.query('UPDATE conversations SET summary=$1,status=$2 WHERE id=$3', [
      'Discussed unfinished website payment integration',
      'ended',
      c.id,
    ]);
    const reopened = await f.reopen();
    f.db = reopened.db;
    f.store = reopened.store;
    f.auth = reopened.auth;
    expect((await f.store.retrieveMemory(f.owner.id, 'website payment'))[0].content).toContain(
      'unfinished',
    );
    expect((await f.store.getConversation(f.owner.id, c.id)).summary).toContain(
      'payment integration',
    );
  });
});
