import pg from 'pg';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import '../lib/env';

// Read-only access to the demo. All mutation/fault tests use recovery_test instead.
export async function demoFingerprint(url=process.env.ADMIN_DATABASE_URL??'postgres://postgres:local-demo-admin@127.0.0.1:55432/recovery') {
  const c=new pg.Client({connectionString:url});
  await c.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const content:Record<string,unknown>={};
    for(const table of ['identities','sessions','clinicians','slots','appointments','waitlist','offers','audit','migrations']) {
      content[table]=(await c.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') AS records FROM ${table} t`)).rows[0].records;
    }
    await c.query('COMMIT');
    return createHash('sha256').update(JSON.stringify(content)).digest('hex');
  } finally {await c.end();}
}
if(process.argv[1]?.endsWith('/demo-fingerprint.ts')) {
  const actual=await demoFingerprint();mkdirSync('.local',{recursive:true});
  if(process.argv[2]==='save')writeFileSync('.local/demo-before-safeguards.txt',actual);
  else assert.equal(actual,readFileSync('.local/demo-before-safeguards.txt','utf8'),'Demo records changed');
  console.log(`Demo fingerprint ${process.argv[2]==='save'?'saved':'unchanged'}: ${actual}`);
}
