import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import '../lib/env';
if(process.env.VERCEL)throw new Error('Local Postgres must not be started on Vercel.');
const port=Number(process.env.LOCAL_POSTGRES_PORT??55432);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid LOCAL_POSTGRES_PORT.');
mkdirSync('.local', { recursive: true });
const db = new EmbeddedPostgres({
  databaseDir: resolve('.local/postgres'), user: 'postgres', password: 'local-demo-admin',
  port, persistent: true, authMethod: 'scram-sha-256',
  autoRehydrateSymlinks: true,
  postgresFlags: ['-h', '127.0.0.1', '-k', resolve('.local')],
  onLog: () => {}, onError: console.error,
});
if (!existsSync('.local/postgres/PG_VERSION')) await db.initialise();
await db.start();
console.log(`Postgres listening on 127.0.0.1:${port}. Persistent data: .local/postgres. Keep this terminal open.`);
const stop = async () => { await db.stop(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
setInterval(() => {}, 60_000);
