import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const { loadConfig } = await import('../server/config.js');
const { connectDatabase } = await import('../server/db/database.js');
const { migrate } = await import('../server/db/migrate.js');
const db = await connectDatabase(loadConfig());
try { await migrate(db); console.log(`Migrations applied (${db.mode}).`); } finally { await db.close(); }
