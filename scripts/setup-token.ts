import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
if (existsSync('.env')) process.loadEnvFile('.env');
const { loadConfig } = await import('../server/config.js');
const { connectDatabase } = await import('../server/db/database.js');
const { migrate } = await import('../server/db/migrate.js');
const { sha256 } = await import('../server/security.js');
const config = loadConfig();
const db = await connectDatabase(config);
try {
  await migrate(db);
  if ((await db.query('SELECT id FROM owners LIMIT 1')).rows.length)
    throw new Error(
      'Account is already initialized. Setup tokens cannot replace or bypass your existing account.',
    );
  const token = randomBytes(32).toString('base64url');
  await db.query(
    "INSERT INTO system_meta(key,value) VALUES ('bootstrap',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",
    [JSON.stringify({ hash: sha256(token), consumed: false })],
  );
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(config.dataDir, 'setup-token'), token, { mode: 0o600 });
  console.log(
    'One-time setup token (keep private; it authorizes creating the owner account):\n' + token,
  );
} finally {
  await db.close();
}
