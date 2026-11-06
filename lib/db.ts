import './env';
import pg, { type PoolClient } from 'pg';
import {attachDatabasePool} from '@vercel/functions';
import {runtimeDatabaseConfig} from './hosting';
export const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:local-demo-admin@127.0.0.1:55432/recovery';
export const databaseUrl = process.env.DATABASE_URL ?? 'postgres://recovery_app:local-demo-app@127.0.0.1:55432/recovery';
const globalDb = globalThis as unknown as { recoveryPool?: pg.Pool };
export const pool = globalDb.recoveryPool ?? new pg.Pool(runtimeDatabaseConfig());
if(!globalDb.recoveryPool) {
  if(process.env.VERCEL)attachDatabasePool(pool);
  pool.on('error',()=>console.error('Idle database connection failed; a new connection will be used.'));
}
globalDb.recoveryPool = pool;

// Small single-clinic prototype: serialize commands AND refreshes (which expire offers)
// across all server processes using this database, even for unrelated patients.
// The lock is transaction-scoped in Postgres, not an in-process JavaScript mutex.
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query('SELECT pg_advisory_xact_lock(710428)');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
