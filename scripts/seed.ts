import pg from 'pg';
import {insertFictionalFixtures} from './fixtures';
import { adminUrl } from '../lib/db';
import { assertSeedAllowed } from './local-safety';
export async function seed(url = adminUrl, resetConfirmed = process.env.RESET_FICTIONAL_DATA==='1') {
  assertSeedAllowed(url,resetConfirmed);
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('TRUNCATE audit, offers, waitlist, appointments, slots, clinicians, sessions, identities RESTART IDENTITY CASCADE');
    await insertFictionalFixtures(c);
    await c.query('COMMIT');
  } catch (error) { await c.query('ROLLBACK'); throw error; }
  finally { await c.end(); }
}
if (process.argv[1]?.endsWith('/seed.ts')) { await seed(); console.log('Fictional demo reset. Existing demo history and sessions were cleared.'); }
