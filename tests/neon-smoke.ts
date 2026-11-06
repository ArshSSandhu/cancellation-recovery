// Operator-run provider compatibility test. Never imported by application routes.
// Requires a separate, freshly copied Neon branch; it never resets any database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import pg from 'pg';
import {runtimeDatabaseConfig} from '../lib/hosting';
let stage='profile validation';

async function main() {
  assert.equal(process.env.NEON_SMOKE_CONFIRM,'isolated-verification-branch');
  const [verification,production]=process.argv.slice(2).map(p=>parseEnv(readFileSync(p,'utf8')));
  const url=new URL(verification.DATABASE_URL!);
  assert.notEqual(url.hostname,new URL(production.DATABASE_URL!).hostname,'Refuse the production endpoint.');
  const pool=new pg.Pool({...runtimeDatabaseConfig({VERCEL:'1',DATABASE_URL:url.toString()}),max:6});
  (globalThis as {recoveryPool?:pg.Pool}).recoveryPool=pool;
  const {execute,getState}=await import('../lib/scheduling');
  const {transaction}=await import('../lib/db');
  stage='connect';const holder=await pool.connect();
  try {
    stage='fresh branch';assert.equal((await pool.query('SELECT count(*)::int AS n FROM offers')).rows[0].n,0,'Use a fresh verification branch.');
    const state=await getState('staff');
    const source=state.appointments.find(a=>a.slot_id==='opening')!;
    stage='cancel';await execute('staff',{kind:'cancel',id:source.id,reason:'Isolated Neon compatibility check'});
    // Hold the production lock and observe two distinct waiting backends.
    // Clear the holder transaction's statistics snapshot on every observation;
    // otherwise pg_stat_activity can keep showing the initial idle connections.
    stage='concurrent send';await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(710428)');
    const sends=Promise.allSettled([1,2].map(()=>execute('staff',{kind:'send',id:'opening',waitlistId:'wait-maya'})));
    const until=Date.now()+4000;let waiters:number[]=[];
    while(Date.now()<until) {
      await holder.query('SELECT pg_stat_clear_snapshot()');
      waiters=(await holder.query("SELECT pid FROM pg_stat_activity WHERE usename=current_user AND wait_event='advisory'")).rows.map(r=>r.pid);
      if(new Set(waiters).size===2)break;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    const overlapped=new Set(waiters).size===2;
    await holder.query('COMMIT');
    const issued=await sends;
    assert.equal(overlapped,true,'Two distinct request backends must wait behind the holder.');
    assert.equal(issued.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(issued.filter(r=>r.status==='rejected').length,1);
    const offer=(await pool.query("SELECT * FROM offers WHERE status='pending'")).rows[0];
    // Rollback after real appointment and audit writes, on this isolated branch only.
    stage='rollback';const before=(await pool.query('SELECT version FROM appointments WHERE id=$1',[offer.source_appointment_id])).rows[0].version;
    await assert.rejects(transaction(async c=>{
      await c.query('UPDATE appointments SET version=version+1 WHERE id=$1',[offer.source_appointment_id]);
      await c.query("INSERT INTO audit(actor_id,action,entity_id,request_id,details) VALUES('staff','test.rollback','neon',gen_random_uuid(),'{}')");
      throw new Error('Test-only rollback');
    }),/Test-only rollback/);
    assert.equal((await pool.query('SELECT version FROM appointments WHERE id=$1',[offer.source_appointment_id])).rows[0].version,before);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit WHERE action='test.rollback'")).rows[0].n,0);
    stage='concurrent acceptance';const accepted=await Promise.all([1,2].map(()=>execute('maya',{kind:'accept',id:offer.id})));
    assert.equal(accepted.filter(r=>'replayed' in r&&!r.replayed).length,1);
    assert.equal(accepted.filter(r=>'replayed' in r&&r.replayed).length,1);
    assert.equal(accepted[0].appointment.id,accepted[1].appointment.id);
    stage='retry and permissions';const retried=await execute('maya',{kind:'accept',id:offer.id});
    assert.equal(retried.replayed,true);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit WHERE action='appointment.moved'")).rows[0].n,1);
    const patient=await getState('maya');
    assert.equal(patient.appointments.filter(a=>a.status==='booked').length,1);
    assert.equal(patient.appointments.find(a=>a.status==='booked').slot_id,'opening');
    await assert.rejects(execute('jordan',{kind:'accept',id:offer.id}),/Offer not found/);
    await assert.rejects(execute('maya',{kind:'send',id:'opening',waitlistId:'wait-jordan'}),/Staff access/);
    await assert.rejects(pool.query('DELETE FROM audit'),/permission denied/);
    console.log('Neon isolated pooler smoke PASS: two observed waiting backends, exclusive send, rollback, concurrent acceptance, recorded retry, ownership/staff boundaries, immutable audit.');
  }finally {
    await holder.query('ROLLBACK').catch(()=>{});holder.release();await pool.end();
  }
}
main().catch((error)=>{console.error('Neon isolated pooler smoke FAILED; credentials withheld.',{stage,code:/^[A-Z0-9]{5}$/.test(error?.code)?error.code:'TEST',...(error?.code==='ERR_ASSERTION'?{expected:error.expected,actual:error.actual}:{})});process.exitCode=1;});
