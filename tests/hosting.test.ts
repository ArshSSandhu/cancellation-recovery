import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoConfig,checkDemoHost,checkDemoOrigin,runtimeDatabaseConfig} from '../lib/hosting';
const hosted={VERCEL:'1',DEMO_MODE:'protected-fictional',REVIEWER_ACCESS:'vercel-auth-all-deployments',APP_ORIGIN:'https://assigned-reviewer.vercel.app',REVIEWER_INSTANCE_ID:'reviewer-owner'};
const database=new URL('postgres://recovery_app@ep-example-pooler.us-east-1.aws.neon.tech/recovery_demo');database.password='fictional';database.searchParams.set('sslmode','require');
test('hosted mode remains disabled without complete protected-reviewer configuration',()=>{
  assert.throws(()=>demoConfig({VERCEL:'1'}),/disabled on Vercel/);
  assert.throws(()=>demoConfig({...hosted,REVIEWER_ACCESS:undefined}),/Reviewer access/);
  assert.throws(()=>demoConfig({...hosted,APP_ORIGIN:'http://assigned-reviewer.vercel.app'}),/HTTPS origin/);
  assert.throws(()=>demoConfig({...hosted,APP_ORIGIN:hosted.APP_ORIGIN+'/path'}),/HTTPS origin/);
  assert.throws(()=>demoConfig({...hosted,REVIEWER_INSTANCE_ID:undefined}),/isolated reviewer/);
});
test('hosted sessions require host-only secure cookies; local production inspection remains supported',()=>{
  assert.equal(demoConfig(hosted).secure,true);assert.equal(demoConfig(hosted).cookieName,'__Host-recovery_session');
  assert.equal(demoConfig({NODE_ENV:'production'}).secure,false);assert.equal(demoConfig({}).cookieName,'recovery_session');
});
test('only the assigned HTTPS origin can mutate; forwarding headers cannot grant access',()=>{
  const headers=new Headers({host:'assigned-reviewer.vercel.app',origin:hosted.APP_ORIGIN});
  assert.doesNotThrow(()=>checkDemoOrigin(headers,hosted));
  for(const origin of ['https://other.vercel.app','null','http://assigned-reviewer.vercel.app'])assert.throws(()=>checkDemoOrigin(new Headers({host:'assigned-reviewer.vercel.app',origin}),hosted),/origin/);
  assert.throws(()=>checkDemoHost(new Headers({host:'other.vercel.app','x-forwarded-host':'assigned-reviewer.vercel.app'}),hosted),/assigned reviewer URL/);
  assert.throws(()=>checkDemoOrigin(new Headers({host:'assigned-reviewer.vercel.app'}),hosted),/origin/);
});
test('runtime hosted database uses a small pooled TLS connection with certificate verification',()=>{
  const result=runtimeDatabaseConfig({...hosted,DATABASE_URL:database.toString()});
  assert.equal(result.max,3);assert.deepEqual(result.ssl,{rejectUnauthorized:true});
  assert.equal(new URL(result.connectionString!).searchParams.has('sslmode'),false);
  for(const change of [
    (u:URL)=>{u.username='neondb_owner';},(u:URL)=>{u.hostname=u.hostname.replace('-pooler','');},
    (u:URL)=>{u.pathname='/recovery';},(u:URL)=>{u.searchParams.set('host','localhost');},
    (u:URL)=>{u.searchParams.set('sslmode','disable');},
  ]){const bad=new URL(database);change(bad);assert.throws(()=>runtimeDatabaseConfig({...hosted,DATABASE_URL:bad.toString()}));}
  assert.throws(()=>runtimeDatabaseConfig(hosted),/not configured/);
});

test('public mode requires explicit shared-public acknowledgement and retains secure origin rules',()=>{
 const env={...hosted,DEMO_MODE:'public-fictional',REVIEWER_ACCESS:'shared-public-fictional'};
 assert.throws(()=>demoConfig({...env,REVIEWER_ACCESS:hosted.REVIEWER_ACCESS}),/Reviewer access/);
 assert.equal(demoConfig(env).secure,true);
 assert.doesNotThrow(()=>checkDemoOrigin(new Headers({host:'assigned-reviewer.vercel.app',origin:env.APP_ORIGIN}),env));
 assert.throws(()=>checkDemoOrigin(new Headers({host:'assigned-reviewer.vercel.app',origin:'https://elsewhere.example'}),env),/origin/);
});
