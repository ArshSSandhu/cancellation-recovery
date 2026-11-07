import pg from 'pg';
import { readFileSync } from 'node:fs';
import { adminUrl } from '../lib/db';
import { assertLocalDatabase } from './local-safety';
const base = new URL(adminUrl); const name = base.pathname.slice(1);
if (!['recovery', 'recovery_test'].includes(name)) throw new Error('Setup only manages recovery or recovery_test');
assertLocalDatabase(adminUrl,name as 'recovery'|'recovery_test');
base.pathname = '/postgres';
const cluster = new pg.Client({ connectionString: base.toString() }); await cluster.connect();
if (!(await cluster.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount) await cluster.query(`CREATE DATABASE ${name}`);
if (!(await cluster.query("SELECT 1 FROM pg_roles WHERE rolname='recovery_app'")).rowCount)
  await cluster.query("CREATE ROLE recovery_app LOGIN PASSWORD 'local-demo-app'");
await cluster.end();
const client = new pg.Client({ connectionString: adminUrl }); await client.connect();
await client.query('BEGIN');
try {
  await client.query('CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY)');
  if (!(await client.query("SELECT 1 FROM migrations WHERE name='001_initial'")).rowCount) {
    await client.query(readFileSync(new URL('../db/001_initial.sql', import.meta.url), 'utf8'));
    await client.query("INSERT INTO migrations VALUES ('001_initial')");
  }
  if (!(await client.query("SELECT 1 FROM migrations WHERE name='002_public_demo'")).rowCount) {
    await client.query(readFileSync(new URL('../db/002_public_demo.sql',import.meta.url),'utf8'));
    await client.query("INSERT INTO migrations VALUES ('002_public_demo')");
  }
  await client.query(`GRANT CONNECT ON DATABASE ${name} TO recovery_app`);
  await client.query('GRANT USAGE ON SCHEMA public TO recovery_app');
  await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON identities, sessions, clinicians, slots, appointments, waitlist, offers TO recovery_app');
  await client.query('GRANT SELECT, INSERT ON audit TO recovery_app');
  await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO recovery_app');
  await client.query('COMMIT');
  console.log(`Migrated ${name}; application role cannot update/delete audit history.`);
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
