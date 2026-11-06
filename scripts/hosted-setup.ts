import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import {readFileSync,writeFileSync,mkdirSync,chmodSync,existsSync} from 'node:fs';
import {insertFictionalFixtures} from './fixtures';
import {runtimeDatabaseConfig} from '../lib/hosting';

// Operator only: never imported by the app, never run in a build hook.
// Local seed/reset safeguards remain intact. This only initializes an empty
// named hosted database, and never truncates or resets an existing database.
async function main() {
if(process.env.VERCEL)throw new Error('Run hosted setup from the operator workstation.');
if(process.env.HOSTED_SETUP_CONFIRM!=='empty-fictional-database')throw new Error('Set HOSTED_SETUP_CONFIRM=empty-fictional-database for this explicit initialization.');
const file=process.argv[2];if(!file)throw new Error('Pass the private pulled Neon environment file path.');
const vars=parseEnv(readFileSync(file,'utf8'));
const owner=new URL(vars.DATABASE_URL_UNPOOLED??vars.DATABASE_URL??'');
if(!owner.hostname.endsWith('.neon.tech')||owner.hostname.includes('-pooler.')||owner.username==='recovery_app')throw new Error('A direct Neon owner connection is required.');
if([...owner.searchParams.keys()].some(k=>!['sslmode','channel_binding','application_name'].includes(k)))throw new Error('Unexpected owner connection parameters.');
owner.searchParams.delete('sslmode');
const ssl={rejectUnauthorized:true};
const admin=new pg.Client({connectionString:owner.toString(),ssl});
const target=new URL(owner);target.pathname='/recovery_demo';
const privateFile='.local/hosting/runtime.env';
let appUrl:URL;
mkdirSync('.local/hosting',{recursive:true});chmodSync('.local/hosting',0o700);
const existingProfile=existsSync(privateFile);
if(existingProfile) {
  const stored=parseEnv(readFileSync(privateFile,'utf8'));
  if(!stored.DATABASE_URL)throw new Error('Existing private runtime profile has no database URL.');
  appUrl=new URL(stored.DATABASE_URL);
  if(appUrl.hostname!==owner.hostname.replace('.', '-pooler.')||appUrl.pathname!=='/recovery_demo'||appUrl.username!=='recovery_app')throw new Error('Existing private runtime profile addresses a different instance.');
}else {
  appUrl=new URL(target);appUrl.hostname=owner.hostname.replace('.','-pooler.');appUrl.username='recovery_app';appUrl.password=randomBytes(32).toString('hex');appUrl.searchParams.set('sslmode','verify-full');
  writeFileSync(privateFile,`DATABASE_URL=${appUrl.toString()}\n`,{mode:0o600});chmodSync(privateFile,0o600);
}
try {
  await admin.connect();
  const roleExists=(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='recovery_app'")).rowCount;
  if(roleExists&&!existingProfile)throw new Error('An existing runtime role needs its known private profile; refusing to rotate it.');
  if(!roleExists) {
    const sql=(await admin.query("SELECT format('CREATE ROLE recovery_app LOGIN NOINHERIT NOCREATEDB NOCREATEROLE PASSWORD %L',$1::text)",[appUrl.password])).rows[0].format;
    await admin.query(sql);
  }
  if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='recovery_demo'")).rowCount)await admin.query('CREATE DATABASE recovery_demo');
  await admin.end();
  const c=new pg.Client({connectionString:target.toString(),ssl});await c.connect();
  try {
    await c.query('BEGIN');
    const migrated=(await c.query("SELECT to_regclass('public.migrations') IS NOT NULL AS present")).rows[0].present;
    if(!migrated) {
      if((await c.query("SELECT 1 FROM pg_tables WHERE schemaname='public'")).rowCount)throw new Error('Refusing to initialize a nonempty database.');
      await c.query('CREATE TABLE migrations(name text PRIMARY KEY)');
      await c.query(readFileSync(new URL('../db/001_initial.sql',import.meta.url),'utf8'));
      await c.query("INSERT INTO migrations VALUES ('001_initial')");
      await insertFictionalFixtures(c);
    }else if(!(await c.query("SELECT 1 FROM migrations WHERE name='001_initial'")).rowCount)throw new Error('Unexpected migration state; initialization stopped.');
    await c.query('GRANT CONNECT ON DATABASE recovery_demo TO recovery_app');
    await c.query(readFileSync(new URL('../db/runtime_role_grants.sql',import.meta.url),'utf8'));
    await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{await c.end();}
  const app=new pg.Client(runtimeDatabaseConfig({VERCEL:'1',DATABASE_URL:appUrl.toString()}));await app.connect();
  try {
    const role=(await app.query('SELECT current_user AS name,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
    if(role.name!=='recovery_app'||role.rolsuper||role.rolcreatedb||role.rolcreaterole)throw new Error('Runtime role privileges are unsafe.');
    if((await app.query('SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)')).rowCount)throw new Error('Runtime role must not inherit or assume other roles.');
    const unsafe=(await app.query("SELECT has_table_privilege(current_user,'audit','UPDATE') OR has_table_privilege(current_user,'audit','DELETE') OR has_table_privilege(current_user,'audit','TRUNCATE') AS unsafe")).rows[0].unsafe;
    if(unsafe)throw new Error('Runtime audit privileges are unsafe.');
    console.log('Hosted schema ready: restricted pooled TLS role, fictional fixtures, audit protections verified. Private runtime profile saved; no credentials displayed.');
  }finally{await app.end();}
}catch(error){await admin.end().catch(()=>{});console.error('Hosted initialization failed.',{code:typeof (error as {code?:unknown}).code==='string'&&(error as {code:string}).code.length===5?(error as {code:string}).code:'UNEXPECTED'});process.exitCode=1;}

}
main().catch(()=>{console.error('Hosted setup refused; credentials withheld. Check the explicit target, private profile and confirmation.');process.exitCode=1;});
