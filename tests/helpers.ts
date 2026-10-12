import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrate.js';
import { Auth } from '../server/services/auth.js';
import { Store } from '../server/services/store.js';
export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(),'krona-test-'));
  const config = loadConfig({ NODE_ENV:'test', DATA_DIR:directory, SESSION_SECRET:'test-session-secret-'.repeat(3), SETUP_TOKEN:'test-bootstrap-token-'.repeat(3), SCHEDULER_ENABLED:'false' });
  // To exercise a real PostgreSQL server, set TEST_DATABASE_URL to a dedicated EMPTY test database.
  // Only the embedded fixture is reused automatically; PostgreSQL integration has a separate suite.
  let db = await connectDatabase(config); await migrate(db);
  const auth=new Auth(db,config); await auth.initialize();
  const owner=await auth.setup({setup_token:config.setupToken,email:'owner@example.test',display_name:'Test owner',password:'secure-test-password-123'});
  return {config, db, auth, owner, store:new Store(db), directory,
    async reopen() { await db.close(); db=await connectDatabase(config); return {db,store:new Store(db),auth:new Auth(db,config)}; },
    async close() { await db.close(); await rm(directory,{recursive:true,force:true}); }
  };
}
