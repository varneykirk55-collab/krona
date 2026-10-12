import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const { loadConfig } = await import('./config.js');
const { connectDatabase } = await import('./db/database.js');
const { migrate } = await import('./db/migrate.js');
const { buildApp } = await import('./app.js');
const config = loadConfig();
let db: Awaited<ReturnType<typeof connectDatabase>> | null = null;
try {
  db = await connectDatabase(config);
  await migrate(db);
  const { app } = await buildApp({ config, db });
  const shutdown = async () => {
    await app.close();
    await db!.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { database: db.mode, live_calls: config.liveCalls, live_ai: config.liveAI },
    'Krona started. No mock providers are exposed by this application.',
  );
  if (config.nodeEnv !== 'production')
    app.log.info(
      'First-run setup token is stored in .data/setup-token (or your DATA_DIR). Keep it private.',
    );
} catch (e) {
  console.error(
    'Startup failed:',
    e instanceof Error ? e.message : 'Invalid configuration or unavailable database',
  );
  if (db) await db.close();
  process.exitCode = 1;
}
