import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Config } from '../config.js';

export interface QueryResult<T> { rows: T[]; rowCount: number }
export interface Database {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  mode: 'postgresql' | 'embedded-postgresql';
}
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>(r => { release = r; });
    await previous;
    try { return await fn(); } finally { release(); }
  }
}
export async function connectDatabase(config: Config): Promise<Database> {
  if (config.databaseUrl) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
    pool.on('error', () => { /* The next health probe surfaces the error; never log connection strings. */ });
    const wrap = (client: pg.Pool | pg.PoolClient, nested = false): Database => ({
      mode: 'postgresql',
      async exec(sql: string) { await client.query(sql); },
      async query<T>(sql: string, params: unknown[] = []) { const r = await client.query(sql, params); return { rows: r.rows as T[], rowCount: r.rowCount || 0 }; },
      async transaction<T>(fn: (tx: Database) => Promise<T>) {
        if (nested) return fn(wrap(client, true));
        const conn = await pool.connect();
        try { await conn.query('BEGIN'); const value = await fn(wrap(conn, true)); await conn.query('COMMIT'); return value; }
        catch (e) { await conn.query('ROLLBACK'); throw e; } finally { conn.release(); }
      },
      async close() { if (!nested) await pool.end(); }
    });
    const db = wrap(pool); await db.query('SELECT 1'); return db;
  }
  const path = resolve(config.dataDir, 'postgres');
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const pglite = new PGlite(path);
  await pglite.waitReady;
  const mutex = new Mutex();
  const raw: Database = {
    mode: 'embedded-postgresql',
    async exec(sql: string) { await pglite.exec(sql); },
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pglite.query<T>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length };
    },
    async transaction<T>(fn: (tx: Database) => Promise<T>) { return fn(raw); },
    async close() { await pglite.close(); }
  };
  return {
    mode: raw.mode,
    exec: (sql: string) => mutex.run(() => raw.exec(sql)),
    query: <T>(sql: string, params: unknown[] = []) => mutex.run(() => raw.query<T>(sql, params)),
    transaction: <T>(fn: (tx: Database) => Promise<T>) => mutex.run(async () => {
      await raw.query('BEGIN');
      try { const result = await fn(raw); await raw.query('COMMIT'); return result; }
      catch (e) { await raw.query('ROLLBACK'); throw e; }
    }),
    close: () => mutex.run(() => raw.close())
  };
}
