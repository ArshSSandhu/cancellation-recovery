// Test-only transport fault. Never imported by the application.
// Uses a separate Next process and recovery_test; production has no fault flag.
import {createServer,request as httpRequest,type ServerResponse} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {demoFingerprint} from './demo-fingerprint';
import {assertLocalDatabase,testEnvironment} from '../scripts/local-safety';

// Capture the configured demo BEFORE switching this process to the test database.
// A clone using a different local port must not depend on another workstation's DB.
const demoUrl=process.env.ADMIN_DATABASE_URL??'postgres://postgres:local-demo-admin@127.0.0.1:55432/recovery';
assertLocalDatabase(demoUrl,'recovery');
const testEnv=testEnvironment();
process.env.DATABASE_URL=testEnv.DATABASE_URL;
process.env.ADMIN_DATABASE_URL=testEnv.ADMIN_DATABASE_URL;
const setup=spawnSync(process.execPath,['--import','tsx','scripts/setup.ts'],{stdio:'inherit',env:process.env});
if(setup.status!==0)process.exit(setup.status??1);
const {seed}=await import('../scripts/seed');
const {pool}=await import('../lib/db');
const {execute,getState}=await import('../lib/scheduling');
const clarityMode=process.env.CLARITY_FIXTURES==='1';
const auditDb=new pg.Pool({connectionString:process.env.DATABASE_URL});
assert.equal((await auditDb.query('SELECT current_database() AS name')).rows[0].name,'recovery_test');
const demoBefore=await demoFingerprint(demoUrl);
const upstream='http://127.0.0.1:3100';
const browserUrl='http://localhost:3101'; // separate cookie host from the user's 127.0.0.1 demo
const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'],{env:process.env,stdio:['ignore','inherit','inherit']});
let armed=false;
let blockedBrowserOffer:string|null=null;
let phase='http';
let fixtureState='';
let browserOfferId:string|null=null;
const evidence:Record<string,unknown>[]=[];
function save(){mkdirSync('.local',{recursive:true});writeFileSync(clarityMode?'.local/clarity-evidence.json':'.local/transport-evidence.json',JSON.stringify({browserUrl,demoBefore,evidence},null,2));}
async function verifyMove(offerId:string) {
  const o=(await auditDb.query('SELECT * FROM offers WHERE id=$1',[offerId])).rows[0];
  assert.equal(o.status,'accepted');
  const source=(await auditDb.query('SELECT * FROM appointments WHERE id=$1',[o.source_appointment_id])).rows[0];
  const result=(await auditDb.query('SELECT * FROM appointments WHERE id=$1',[o.result_appointment_id])).rows[0];
  assert.equal(source.status,'replaced');assert.equal(source.replacement_id,result.id);assert.equal(result.status,'booked');
  const moves=(await auditDb.query("SELECT count(*)::int AS count FROM audit WHERE action='appointment.moved' AND details->>'offerId'=$1",[offerId])).rows[0].count;
  assert.equal(moves,1);
  return {offerId,appointmentId:result.id,sourceStatus:source.status,offerStatus:o.status,moveAuditEntries:moves};
}
const proxy=createServer(async(req,res)=>{
  try {
    if(clarityMode&&req.url==='/__fixture/prepare'&&req.method==='POST') {
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const state=JSON.parse(Buffer.concat(chunks).toString()).state;
      if(!['zero','eligible','shortened','pending','accepted','revoked','expired','uncertain','deadline'].includes(state)){res.writeHead(400);res.end('Unknown isolated fixture');return;}
      await prepareClarity(state);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({fixture:state}));return;
    }
    if(req.url==='/__fault/status') {
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({armed,blockedBrowserOffer,phase,evidence}));return;
    }
    if(req.url==='/__fault/release'&&req.method==='POST') {
      // Browser transports can transparently retry a dropped connection. Hold
      // all acceptance responses for this offer until the operator restores delivery.
      armed=false;blockedBrowserOffer=null;res.end('Test response delivery restored');return;
    }
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body=Buffer.concat(chunks);
    const isAccept=req.method==='POST'&&req.url==='/api/action'&&JSON.parse(body.toString()).kind==='accept';
    const acceptId=isAccept?JSON.parse(body.toString()).id as string:null;
    const discard=isAccept&&(armed||(phase==='browser'&&blockedBrowserOffer===acceptId));
    if(discard){armed=false;if(phase==='browser')blockedBrowserOffer=acceptId;}
    const upstreamRequest=httpRequest(new URL(req.url??'/',upstream),{
      method:req.method,
      headers:{...req.headers,host:'127.0.0.1:3100',...(req.headers.origin?{origin:upstream}:{})},
    },upstreamResponse=>{
      if(!discard) {
        res.writeHead(upstreamResponse.statusCode??502,upstreamResponse.headers);upstreamResponse.pipe(res);return;
      }
      // Deliberately withhold ALL response headers/body. Wait until the real route
      // has completed, independently verify the commit, then break the client socket.
      const responseChunks:Buffer[]=[];
      upstreamResponse.on('data',chunk=>responseChunks.push(Buffer.from(chunk)));
      upstreamResponse.on('end',()=>{void (async()=>{
        assert.equal(upstreamResponse.statusCode,200);
        const committed=await verifyMove(JSON.parse(body.toString()).id);
        const upstreamBody=JSON.parse(Buffer.concat(responseChunks).toString());
        assert.equal(upstreamBody.appointment.id,committed.appointmentId);
        evidence.push({phase,fixtureState,event:'response-discarded-after-verified-commit',upstreamStatus:upstreamResponse.statusCode,replayed:upstreamBody.replayed,...committed});save();
        console.log(`DISCARDED ${phase} acceptance response AFTER verified commit: ${committed.appointmentId}`);
        res.destroy();
      })().catch(error=>failProxy(error,res));});
    });
    upstreamRequest.on('error',error=>failProxy(error,res));upstreamRequest.end(body);
  } catch(error){failProxy(error,res);}
});
function failProxy(error:unknown,res:ServerResponse){console.error(error);res.destroy(error instanceof Error?error:undefined);}
await new Promise<void>(resolve=>proxy.listen(3101,'127.0.0.1',resolve));
const until=Date.now()+15000;
while(true){try{const r=await fetch(upstream+'/api/state');if(r.status===401)break;}catch{}if(Date.now()>until)throw new Error('Isolated test app did not start');await new Promise(r=>setTimeout(r,100));}
async function post(base:string,path:string,body:object,cookie='') {
  return await fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
}
async function login(base:string,id:string){const r=await post(base,'/api/demo',{identityId:id});assert.equal(r.status,200);return r.headers.get('set-cookie')!.split(';')[0];}
async function fixture() {
  await seed(process.env.ADMIN_DATABASE_URL);
  const staff=await login(upstream,'staff');
  const state=await (await fetch(upstream+'/api/state',{headers:{Cookie:staff}})).json();
  const source=state.appointments.find((a:{slot_id:string})=>a.slot_id==='opening');
  assert.equal((await post(upstream,'/api/action',{kind:'cancel',id:source.id,reason:'Isolated transport test'},staff)).status,200);
  const sent=await post(upstream,'/api/action',{kind:'send',id:'opening',waitlistId:'wait-maya'},staff);assert.equal(sent.status,200);
  return (await sent.json()).offerId as string;
}
async function prepareClarity(state:string) {
  fixtureState=state;phase='browser';armed=false;blockedBrowserOffer=null;
  if(state==='shortened') {
    await seed(process.env.ADMIN_DATABASE_URL);
    await auditDb.query("INSERT INTO slots VALUES ('shortened','lee',statement_timestamp()+interval '25 hours',statement_timestamp()+interval '25 hours 30 minutes','follow-up','video','Clinic video portal')");
    browserOfferId=null;
  } else {
    const id=await fixture();browserOfferId=id;
    if(state==='eligible') {
      // Return to the unoffered opening without creating a policy exception.
      await seed(process.env.ADMIN_DATABASE_URL);
      const state=await getState('staff');const source=state.appointments.find(a=>a.slot_id==='opening');
      await execute('staff',{kind:'cancel',id:source!.id,reason:'Isolated unoffered opening'});
      browserOfferId=null;
    }
    if(state==='accepted'||state==='zero')await execute('maya',{kind:'accept',id});
    if(state==='revoked')await execute('staff',{kind:'revoke',id,reason:'Isolated withdrawn-offer fixture'});
    if(state==='expired') {
      await auditDb.query("UPDATE offers SET created_at=clock_timestamp()-interval '3 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",[id]);
      await getState('maya');
    }
    if(state==='zero') {
      const next=await execute('staff',{kind:'send',id:'maya-old',waitlistId:'wait-jordan'});
      await execute('staff',{kind:'revoke',id:next.offerId!,reason:'Isolated zero-eligible fixture'});
    }
    if(state==='deadline')await auditDb.query("UPDATE offers SET expires_at=clock_timestamp()+interval '25 seconds' WHERE id=$1",[id]);
    if(state==='uncertain')armed=true;
  }
  evidence.push({event:'isolated-fixture-prepared',fixtureState});save();
}

// Automated HTTP test: this uses the actual route/session/transaction, not execute().
if(!clarityMode) {
const offerId=await fixture();const patient=await login(browserUrl,'maya');armed=true;
await assert.rejects(post(browserUrl,'/api/action',{kind:'accept',id:offerId},patient),/fetch failed/);
const committed=await verifyMove(offerId);
const refresh=await (await fetch(browserUrl+'/api/state',{headers:{Cookie:patient}})).json();
assert.equal(refresh.appointments.find((a:{status:string})=>a.status==='booked').id,committed.appointmentId);
const retried=await post(browserUrl,'/api/action',{kind:'accept',id:offerId},patient);assert.equal(retried.status,200);
const result=await retried.json();assert.equal(result.replayed,true);assert.equal(result.appointment.id,committed.appointmentId);
await verifyMove(offerId);
evidence.push({phase:'http',event:'refresh-and-retry-recovered-same-booking',...committed});save();
console.log('HTTP lost-response check passed: request failed at client; refresh and retry recovered one audited booking.');

phase='browser';browserOfferId=await fixture();armed=true;save();
console.log(`BROWSER READY: ${browserUrl} — sign in as Maya. Acceptance response will be discarded after commit. Offer ${browserOfferId}`);
} else {await prepareClarity('zero');console.log(`CLARITY FIXTURES READY: ${browserUrl}. Prepare other states with POST /__fixture/prepare. Only recovery_test is reset.`);}
let stopping=false;
async function stop(){
  if(stopping)return;stopping=true;
  let exitCode=0;
  try {
    if(!clarityMode&&browserOfferId&&evidence.some(row=>row.phase==='browser'))evidence.push({phase:'browser',event:'final-database-check',...await verifyMove(browserOfferId)});
    const demoAfter=await demoFingerprint(demoUrl);assert.equal(demoAfter,demoBefore,'Demo records changed during transport tests');
    evidence.push({event:'demo-unchanged',demoAfter});save();console.log('Demo fingerprint unchanged.');
  } catch(error){console.error(error);exitCode=1;}
  finally {proxy.closeAllConnections();proxy.close();app.kill('SIGTERM');await auditDb.end();await pool.end();process.exit(exitCode);}
}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
