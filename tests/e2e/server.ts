import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../../server/config.js';
import { connectDatabase } from '../../server/db/database.js';
import { migrate } from '../../server/db/migrate.js';
import { buildApp } from '../../server/app.js';
await mkdir('.data', { recursive: true });
const directory = await mkdtemp(resolve('.data/e2e-'));
const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '8081',
  DATA_DIR: directory,
  SESSION_SECRET: 'isolated-e2e-only-session-secret-123456789',
  SETUP_TOKEN: 'isolated-e2e-only-setup-token-123456789',
  SCHEDULER_ENABLED: 'true',
  SCHEDULER_INTERVAL_MS: '1000',
  PUBLIC_BASE_URL: 'http://localhost:8081',
  DASHBOARD_ORIGIN: 'http://localhost:8081',
});
const db = await connectDatabase(config);
await migrate(db);
const { app } = await buildApp({ db, config, logger: false });
const stop = async () => {
  await app.close();
  await db.close();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
await app.listen({ port: 8081, host: '0.0.0.0' });
console.log('Isolated E2E server ready. No providers or fake personal data configured.');
