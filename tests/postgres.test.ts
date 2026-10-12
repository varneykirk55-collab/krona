import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { connectDatabase, type Database } from '../server/db/database.js';
import { loadConfig } from '../server/config.js';
import { migrate } from '../server/db/migrate.js';
import { Auth } from '../server/services/auth.js';
import { Scheduler } from '../server/services/scheduler.js';
import { MockTelephone } from './fakes.js';
import { Store } from '../server/services/store.js';
let pgConfig: ReturnType<typeof loadConfig>;
let server: EmbeddedPostgres | null = null,
  db: Database,
  admin: Database | null = null,
  directory: string,
  ownerId: string,
  schema = 'krona_test_' + randomUUID().replaceAll('-', ''),
  role = 'krona_untrusted_' + randomUUID().replaceAll('-', '');
async function unusedPort() {
  const socket = createServer();
  await new Promise<void>((r) => socket.listen(0, '127.0.0.1', r));
  const port = (socket.address() as any).port;
  await new Promise<void>((r) => socket.close(() => r()));
  return port;
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'krona-pg-server-'));
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const port = await unusedPort();
    server = new EmbeddedPostgres({
      databaseDir: join(directory, 'cluster'),
      user: 'postgres',
      password: 'isolated-test-only-postgres-password',
      port,
      authMethod: 'scram-sha-256',
      persistent: false,
      postgresFlags: ['-h', '127.0.0.1'],
      onLog: () => {},
      onError: () => {},
    });
    await server.initialise();
    await server.start();
    await server.createDatabase('krona_test');
    url = `postgresql://postgres:isolated-test-only-postgres-password@127.0.0.1:${port}/krona_test`;
  }
  const config = (pgConfig = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: directory,
    SESSION_SECRET: 'postgres-only-test-session-secret-123456789',
    SETUP_TOKEN: 'postgres-only-test-setup-token-123456789',
    DATABASE_URL: url,
  }));
  admin = await connectDatabase(config);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const scoped = new URL(url);
  scoped.searchParams.set('options', `-c search_path=${schema}`);
  config.databaseUrl = scoped.toString();
  db = await connectDatabase(config);
  await migrate(db);
  const auth = new Auth(db, config);
  await auth.initialize();
  ownerId = (
    await auth.setup({
      setup_token: config.setupToken,
      email: 'postgres-owner@example.test',
      display_name: 'Postgres test',
      password: 'isolated-test-only-password-123',
    })
  ).id;
});
afterAll(async () => {
  if (db) await db.close();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.close();
  }
  if (server) await server.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe('Standalone PostgreSQL 16 integration (real network pg driver, not PGlite)', () => {
  it('runs migrations idempotently and uses the actual pg driver', async () => {
    expect(db.mode).toBe('postgresql');
    await migrate(db);
    const v = (await db.query('SELECT version() AS version')).rows[0].version;
    console.info('Integration server: ' + v.split(' on ')[0]);
    expect(v).toContain('PostgreSQL');
    expect(
      (await db.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count,
    ).toBeGreaterThanOrEqual(2);
  });
  it('persists real tasks, dependencies, JSON project fields and memories', async () => {
    const s = new Store(db),
      p = await s.createProject(ownerId, {
        name: 'Real PostgreSQL project',
        blockers: ['Actual JSONB data'],
      }),
      task = await s.createTask(ownerId, { title: 'Test payment integration', project_id: p.id }),
      child = await s.createTask(ownerId, {
        title: 'Deploy after testing',
        dependencies: [task.id],
      });
    expect(child.dependencies).toEqual([task.id]);
    const m = await s.createMemory(ownerId, {
      content: 'The PostgreSQL website project uses checkout payments',
    });
    expect(
      (await s.retrieveMemory(ownerId, 'Where was website checkout left off?')).some(
        (x) => x.id === m.id,
      ),
    ).toBe(true);
    expect((await s.listProjects(ownerId))[0].blockers).toEqual(['Actual JSONB data']);
  });
  it('rolls back failed mutations and enforces RLS even with SELECT permission', async () => {
    const s = new Store(db),
      a = await s.createTask(ownerId, { title: 'Dependency A' }),
      b = await s.createTask(ownerId, { title: 'Dependency B', dependencies: [a.id] });
    await expect(s.updateTask(ownerId, a.id, { dependencies: [b.id] })).rejects.toMatchObject({
      code: 'DEPENDENCY_CYCLE',
    });
    expect((await s.getTask(ownerId, a.id)).dependencies).toEqual([]);
    await db.query(`CREATE ROLE ${role} NOLOGIN`);
    await db.transaction(async (tx) => {
      await tx.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
      await tx.query(`GRANT SELECT ON memories TO ${role}`);
      await tx.query(`SET LOCAL ROLE ${role}`);
      expect((await tx.query('SELECT * FROM memories')).rows).toHaveLength(0);
    });
  });
  it('uses native PostgreSQL SKIP LOCKED and prevents two workers claiming one occurrence', async () => {
    const now = new Date(),
      s = new Store(db),
      schedule = await s.createSchedule(ownerId, {
        title: 'Real database claim test',
        next_run_at: new Date(now.getTime() - 60000).toISOString(),
      }),
      worker = new Scheduler(db, pgConfig, new MockTelephone());
    await db.transaction(async (tx) => {
      await tx.query('SELECT id FROM scheduled_jobs WHERE schedule_id=$1 FOR UPDATE', [
        schedule.id,
      ]);
      expect(await worker.claim(now)).toBeNull();
    });
    const claims = await Promise.all([
      worker.claim(now),
      new Scheduler(db, pgConfig, new MockTelephone()).claim(now),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(
      (await db.query('SELECT status FROM scheduled_jobs WHERE schedule_id=$1', [schedule.id]))
        .rows[0].status,
    ).toBe('claimed');
  });
});
