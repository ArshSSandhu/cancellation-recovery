import '../lib/env';

export function assertLocalDatabase(url:string, name:'recovery'|'recovery_test') {
  const target=new URL(url);
  if(process.env.VERCEL || !['postgres:','postgresql:'].includes(target.protocol) ||
    !['127.0.0.1','localhost','[::1]'].includes(target.hostname) || target.pathname!==`/${name}`)
    throw new Error(`Local tools require a loopback Postgres URL for ${name}; hosted databases are refused.`);
  // pg accepts query parameters that can override the apparent URL host/database.
  // Permit only display/TLS settings, never alternate connection destinations.
  if([...target.searchParams.keys()].some(key=>!['application_name','sslmode'].includes(key)))
    throw new Error('Local tools refuse connection query parameters that may override the database target.');
  return target;
}
export function testEnvironment() {
  const admin=process.env.TEST_ADMIN_DATABASE_URL??'postgres://postgres:local-demo-admin@127.0.0.1:55432/recovery_test';
  const app=process.env.TEST_DATABASE_URL??'postgres://recovery_app:local-demo-app@127.0.0.1:55432/recovery_test';
  const a=assertLocalDatabase(admin,'recovery_test'),b=assertLocalDatabase(app,'recovery_test');
  if(a.hostname!==b.hostname||a.port!==b.port)throw new Error('Test admin and app URLs must address the same isolated database.');
  return {...process.env,ADMIN_DATABASE_URL:admin,DATABASE_URL:app};
}
export function assertSeedAllowed(url:string, resetConfirmed=false) {
  const name=new URL(url).pathname.slice(1);
  if(name!=='recovery'&&name!=='recovery_test')throw new Error('Seed only manages recovery or recovery_test.');
  assertLocalDatabase(url,name);
  if(name==='recovery'&&!resetConfirmed)throw new Error('Reset refused. Set RESET_FICTIONAL_DATA=1 to erase fictional demo records, sessions and audit history.');
}
