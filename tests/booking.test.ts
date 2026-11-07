import {test,beforeEach,after,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {testEnvironment} from '../scripts/local-safety';
const testEnv=testEnvironment();
const appUrl=new URL(testEnv.DATABASE_URL);appUrl.searchParams.set('application_name','recovery-race-tests');
process.env.DATABASE_URL=appUrl.toString();
process.env.ADMIN_DATABASE_URL=testEnv.ADMIN_DATABASE_URL;
const {pool}=await import('../lib/db');
const {execute,getState}=await import('../lib/scheduling');
const {seed}=await import('../scripts/seed');
const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL});
beforeEach(async()=>{await seed(process.env.ADMIN_DATABASE_URL);});
after(async()=>{await pool.end();await admin.end();});
async function open(){const s=await getState('staff');const a=s.appointments.find(a=>a.slot_id==='opening');await execute('staff',{kind:'cancel',id:a!.id,reason:'Patient cancelled'});}
async function offer(patient='maya',reason?:string){await open();return await execute('staff',{kind:'send',id:'opening',waitlistId:`wait-${patient}`,reason});}
async function status(){return (await pool.query("SELECT slot_id,status FROM appointments WHERE patient_id='maya' ORDER BY starts_at")).rows;}

// No production hooks: hold the real scheduling lock, then observe each request
// waiting on it in pg_stat_activity before launching the next. Every waiter has
// its own backend PID/connection. Launch order gives us both race outcomes.
async function overlap(t:TestContext, operations:(()=>ReturnType<typeof execute>)[], beforeRelease?:(blocker:pg.PoolClient)=>Promise<void>) {
  const blocker=await admin.connect();
  const pending:Promise<PromiseSettledResult<Awaited<ReturnType<typeof execute>>>>[]=[];
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(710428)');
    for(const operation of operations) {
      pending.push(operation().then(value=>({status:'fulfilled' as const,value}),reason=>({status:'rejected' as const,reason})));
      const until=Date.now()+2000;let waiting:pg.QueryResultRow[]=[];
      do {
        waiting=(await admin.query(`SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
          WHERE datname=current_database() AND application_name='recovery-race-tests'
          AND state='active' AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(710428)%' ORDER BY query_start`)).rows;
        if(waiting.length===pending.length)break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }while(Date.now()<until);
      assert.equal(waiting.length,pending.length,'Every request must be observed waiting on the real database lock');
      assert.equal(new Set(waiting.map(row=>row.pid)).size,pending.length,'Requests must use distinct database connections');
      assert.ok(waiting.every(row=>row.blockers.length>0));
      t.diagnostic(`Observed queued backend PIDs: ${waiting.map(row=>row.pid).join(', ')}`);
    }
    if(beforeRelease)await beforeRelease(blocker);
  } finally {
    await blocker.query('ROLLBACK');blocker.release();
    await Promise.all(pending); // don't leave a request running if an assertion fails
  }
  return await Promise.all(pending);
}
function fulfilled<T>(result:PromiseSettledResult<T>):T {
  if(result.status==='rejected')throw result.reason;return result.value;
}
async function assertMove(offerId:string,moved:boolean) {
  const o=(await pool.query('SELECT * FROM offers WHERE id=$1',[offerId])).rows[0];
  const bookings=await status();
  assert.deepEqual(bookings,moved?[{slot_id:'opening',status:'booked'},{slot_id:'maya-old',status:'replaced'}]:[{slot_id:'maya-old',status:'booked'}]);
  assert.equal(o.status,moved?'accepted':'revoked');
  const source=(await pool.query('SELECT * FROM appointments WHERE id=$1',[o.source_appointment_id])).rows[0];
  assert.equal(source.replacement_id,o.result_appointment_id);
  assert.equal((await pool.query("SELECT 1 FROM audit WHERE action='appointment.moved'")).rowCount,moved?1:0);
  assert.equal((await pool.query("SELECT 1 FROM audit WHERE action='offer.revoked'")).rowCount,moved?0:1);
  assert.equal((await pool.query("SELECT status FROM waitlist WHERE id='wait-maya'")).rows[0].status,moved?'completed':'active');
}

test('matching excludes other clinicians and uncleared patients; longest waiting first',async()=>{
  await open();const s=await getState('staff');
  assert.deepEqual(s.openings[0].candidates.map((c:{patient_id:string})=>c.patient_id),['maya','jordan']);
  assert.ok(s.openings[0].candidates[0].reasons.includes('Same clinician'));
});
test('staff exclusions are actual failed eligibility checks and never appear in patient openings',async()=>{
  await open();
  let s=await getState('staff');let excluded=s.openings[0].excluded;
  assert.deepEqual(excluded.find((x:{name:string})=>x.name==='Sam Rivera').reasons,['Different clinician.']);
  assert.deepEqual(excluded.find((x:{name:string})=>x.name==='Casey Park').reasons,['Staff scheduling clearance is not recorded.']);
  await admin.query("UPDATE waitlist SET opted_in=false WHERE id='wait-maya'");
  await admin.query("UPDATE waitlist SET available_from=(SELECT starts_at+interval '1 hour' FROM slots WHERE id='opening') WHERE id='wait-jordan'");
  s=await getState('staff');excluded=s.openings[0].excluded;
  assert.equal(s.openings[0].candidates.length,0);
  assert.deepEqual(excluded.find((x:{name:string})=>x.name==='Maya Chen').reasons,['Patient has not opted in to earlier-visit offers.']);
  assert.deepEqual(excluded.find((x:{name:string})=>x.name==='Jordan Ellis').reasons,['Outside the patient’s requested availability.']);
  assert.equal((await getState('maya')).openings.length,0);
  await assert.rejects(execute('staff',{kind:'send',id:'opening',waitlistId:'wait-maya'}),/no longer eligible/);
});
test('active and previous offers produce their corresponding exclusion reasons',async()=>{
  const o=await offer();let s=await getState('staff');
  assert.ok(s.openings[0].excluded.find((x:{name:string})=>x.name==='Maya Chen').reasons.includes('An offer is already active for this appointment.'));
  await execute('staff',{kind:'revoke',id:o.offerId!,reason:'Isolated explanation test'});s=await getState('staff');
  assert.ok(s.openings[0].excluded.find((x:{name:string})=>x.name==='Maya Chen').reasons.includes('A previous offer for this opening was withdrawn by the clinic.'));
});
test('database-level lost result: refresh and retry recover one already committed move',async()=>{
  const o=await offer();await execute('maya',{kind:'accept',id:o.offerId!}); // deliberately discard the service result
  const refreshed=await getState('maya');
  const committed=refreshed.offers.find(row=>row.id===o.offerId)!.result_appointment_id;
  assert.equal(refreshed.appointments.find(a=>a.status==='booked')!.id,committed);
  // A retry after the deadline must still recover the earlier success.
  await admin.query("UPDATE offers SET created_at=clock_timestamp()-interval '3 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",[o.offerId]);
  const again=await execute('maya',{kind:'accept',id:o.offerId!});
  assert.equal(committed,again.appointment.id);assert.equal(again.replayed,true);
  assert.deepEqual(await status(),[{slot_id:'opening',status:'booked'},{slot_id:'maya-old',status:'replaced'}]);
  const rows=(await pool.query("SELECT details FROM audit WHERE action='appointment.moved'")).rows;
  assert.equal(rows.length,1);assert.ok(rows[0].details.fromAppointmentId);
});
test('two overlapping acceptances use distinct connections and resolve to one audited move',async t=>{
  const o=await offer();const results=(await overlap(t,[()=>execute('maya',{kind:'accept',id:o.offerId!}),()=>execute('maya',{kind:'accept',id:o.offerId!})])).map(fulfilled);
  assert.equal(new Set(results.map(r=>r.appointment.id)).size,1);
  assert.equal(results.filter(r=>!r.replayed).length,1);
  assert.equal(results.filter(r=>r.replayed).length,1);
  await assertMove(o.offerId!,true);
});
test('two staff members overlap sending: one exclusive offer and one offer audit entry survive',async t=>{
  await open();await admin.query("INSERT INTO identities VALUES ('staff-two','Second fictional scheduler','staff')");
  const results=await overlap(t,[
    ()=>execute('staff',{kind:'send',id:'opening',waitlistId:'wait-maya'}),
    ()=>execute('staff-two',{kind:'send',id:'opening',waitlistId:'wait-jordan',reason:'Patient requested this time'}),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results[1].status,'rejected');
  if(results[1].status==='rejected')assert.match(results[1].reason.message,/exclusive offer/);
  assert.equal((await pool.query("SELECT 1 FROM offers WHERE status='pending'")).rowCount,1);
  assert.equal((await pool.query("SELECT patient_id FROM offers WHERE status='pending'")).rows[0].patient_id,'maya');
  assert.equal((await pool.query("SELECT 1 FROM audit WHERE action='offer.sent'")).rowCount,1);
  assert.deepEqual(await status(),[{slot_id:'maya-old',status:'booked'}]);
});
test('staff override requires a reason and records it',async()=>{
  await open();await assert.rejects(execute('staff',{kind:'send',id:'opening',waitlistId:'wait-jordan'}),/Record why/);
  const o=await execute('staff',{kind:'send',id:'opening',waitlistId:'wait-jordan',reason:'Confirmed availability by phone'});
  assert.equal((await pool.query('SELECT selection_reason FROM offers WHERE id=$1',[o.offerId])).rows[0].selection_reason,'Confirmed availability by phone');
});
test('database failure after booking writes rolls back every part of the move',async()=>{
  const o=await offer();
  await admin.query(`CREATE FUNCTION fail_move_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='appointment.moved' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_move BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION fail_move_audit()`);
  try{
    await assert.rejects(execute('maya',{kind:'accept',id:o.offerId!}),/Injected audit failure/);
    assert.deepEqual(await status(),[{slot_id:'maya-old',status:'booked'}]);
    assert.equal((await pool.query('SELECT status FROM offers WHERE id=$1',[o.offerId])).rows[0].status,'pending');
    assert.equal((await pool.query("SELECT status FROM waitlist WHERE id='wait-maya'")).rows[0].status,'active');
    assert.equal((await pool.query("SELECT 1 FROM audit WHERE action='appointment.moved'")).rowCount,0);
  }finally{await admin.query('DROP TRIGGER fail_move ON audit; DROP FUNCTION fail_move_audit()');}
});
test('expired offers reject acceptance and retain the old booking',async()=>{
  const o=await offer();await admin.query("UPDATE offers SET created_at=clock_timestamp()-interval '3 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",[o.offerId]);
  await assert.rejects(execute('maya',{kind:'accept',id:o.offerId!}),/expired/);
  assert.deepEqual(await status(),[{slot_id:'maya-old',status:'booked'}]);
  const state=await getState('maya');assert.equal(state.offers[0].status,'expired');
});
test('observed acceptance lock wait crosses deadline and preserves the entire original booking',async t=>{
  const o=await offer();const before=(await pool.query("SELECT * FROM appointments WHERE patient_id='maya'")).rows;
  // Set a short deadline outside the blocker transaction so it survives release.
  await admin.query("UPDATE offers SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE id=$1",[o.offerId]);
  const results=await overlap(t,[()=>execute('maya',{kind:'accept',id:o.offerId!})],async blocker=>{
    assert.equal((await blocker.query('SELECT expires_at>clock_timestamp() AS valid FROM offers WHERE id=$1',[o.offerId])).rows[0].valid,true,'Acceptance must be waiting before expiry');
    await blocker.query("SELECT pg_sleep(GREATEST(0,extract(epoch FROM (expires_at-clock_timestamp())))+0.05) FROM offers WHERE id=$1",[o.offerId]);
  });
  assert.equal(results[0].status,'rejected');if(results[0].status==='rejected')assert.match(results[0].reason.message,/expired/);
  assert.deepEqual((await pool.query("SELECT * FROM appointments WHERE patient_id='maya'")).rows,before);
  assert.equal((await pool.query("SELECT 1 FROM audit WHERE action='appointment.moved'")).rowCount,0);
  assert.equal((await getState('maya')).offers[0].status,'expired');
});
test('decline and revocation retain the source booking',async()=>{
  const o=await offer();await execute('maya',{kind:'decline',id:o.offerId!});
  await assert.rejects(execute('maya',{kind:'accept',id:o.offerId!}),/declined/);
  const next=await execute('staff',{kind:'send',id:'opening',waitlistId:'wait-jordan'});
  await execute('staff',{kind:'revoke',id:next.offerId!,reason:'Clinician unavailable'});
  await assert.rejects(execute('jordan',{kind:'accept',id:next.offerId!}),/revoked/);
  assert.deepEqual(await status(),[{slot_id:'maya-old',status:'booked'}]);
});
test('overlapping stale and current recipients: only the current exclusive offer can be accepted',async t=>{
  const old=await offer();await execute('staff',{kind:'revoke',id:old.offerId!,reason:'Reassigning after discussion'});
  const next=await execute('staff',{kind:'send',id:'opening',waitlistId:'wait-jordan'});
  const results=await overlap(t,[()=>execute('maya',{kind:'accept',id:old.offerId!}),()=>execute('jordan',{kind:'accept',id:next.offerId!})]);
  assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');
  assert.deepEqual(await status(),[{slot_id:'maya-old',status:'booked'}]);
  assert.equal((await pool.query("SELECT patient_id FROM appointments WHERE slot_id='opening' AND status='booked'")).rows[0].patient_id,'jordan');
  assert.equal((await pool.query("SELECT 1 FROM audit WHERE action='appointment.moved'")).rowCount,1);
});
test('expired exclusive hold can be offered to the next eligible patient',async()=>{
  const old=await offer();await admin.query("UPDATE offers SET created_at=clock_timestamp()-interval '3 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",[old.offerId]);
  await execute('staff',{kind:'send',id:'opening',waitlistId:'wait-jordan'});
  assert.equal((await pool.query('SELECT status FROM offers WHERE id=$1',[old.offerId])).rows[0].status,'expired');
  assert.equal((await pool.query("SELECT 1 FROM audit WHERE action='offer.expired'")).rowCount,1);
});
for(const winner of ['revoke','accept'] as const)test(`overlapping revoke/accept: ${winner} wins with consistent offer, appointments and audit`,async t=>{
  const o=await offer();const revoke=()=>execute('staff',{kind:'revoke',id:o.offerId!,reason:'Schedule changed'});
  const accept=()=>execute('maya',{kind:'accept',id:o.offerId!});
  const results=await overlap(t,winner==='revoke'?[revoke,accept]:[accept,revoke]);
  fulfilled(results[0]);assert.equal(results[1].status,'rejected');
  await assertMove(o.offerId!,winner==='accept');
});
test('ownership, staff permissions and patient read boundaries are enforced',async()=>{
  const o=await offer();await assert.rejects(execute('jordan',{kind:'accept',id:o.offerId!}),/Offer not found/);
  await assert.rejects(execute('jordan',{kind:'decline',id:o.offerId!}),/Offer not found/);
  await assert.rejects(execute('maya',{kind:'revoke',id:o.offerId!,reason:'x'}),/Staff access/);
  await assert.rejects(execute('maya',{kind:'send',id:'opening',waitlistId:'wait-maya'}),/Staff access/);
  await assert.rejects(execute('staff',{kind:'accept',id:o.offerId!}),/Patient access/);
  const state=await getState('jordan');assert.equal(state.offers.length,0);assert.equal(state.audit.length,0);
  assert.ok(state.appointments.every(a=>a.patient_name==='Jordan Ellis'));assert.deepEqual(await status(),[{slot_id:'maya-old',status:'booked'}]);
});
test('changed eligibility or source version prevents acceptance',async()=>{
  const o=await offer();await admin.query("UPDATE waitlist SET cleared=false WHERE id='wait-maya'");
  await assert.rejects(execute('maya',{kind:'accept',id:o.offerId!}),/no longer eligible/);
  await admin.query("UPDATE waitlist SET cleared=true WHERE id='wait-maya'");
  await admin.query("UPDATE appointments SET version=version+1 WHERE slot_id='maya-old'");
  await assert.rejects(execute('maya',{kind:'accept',id:o.offerId!}),/original booking changed/);
  assert.deepEqual(await status(),[{slot_id:'maya-old',status:'booked'}]);
});
test('a real change to the original appointment rejects the stale offer and preserves the current booking',async()=>{
  const o=await offer();
  // Test-only stand-in for a future scheduling writer: change the actual booking
  // and advance its version, not just the version counter.
  await admin.query("INSERT INTO slots SELECT 'changed-original',clinician_id,starts_at+interval '1 day',ends_at+interval '1 day',visit_type,modality,location FROM slots WHERE id='maya-old'");
  await admin.query(`UPDATE appointments a SET slot_id=s.id,starts_at=s.starts_at,ends_at=s.ends_at,version=version+1
    FROM slots s WHERE a.slot_id='maya-old' AND s.id='changed-original'`);
  const current=(await pool.query("SELECT * FROM appointments WHERE patient_id='maya'")).rows;
  await assert.rejects(execute('maya',{kind:'accept',id:o.offerId!}),/original booking changed/);
  assert.deepEqual((await pool.query("SELECT * FROM appointments WHERE patient_id='maya'")).rows,current);
  assert.equal(current[0].status,'booked');assert.equal(current[0].slot_id,'changed-original');
  assert.equal((await pool.query('SELECT status FROM offers WHERE id=$1',[o.offerId])).rows[0].status,'pending');
  assert.equal((await pool.query("SELECT 1 FROM appointments WHERE slot_id='opening' AND status='booked'")).rowCount,0);
  assert.equal((await pool.query("SELECT 1 FROM audit WHERE action='appointment.moved'")).rowCount,0);
});
test('full and shortened deadlines use the earlier time; past cutoff rejects sending',async()=>{
  const o=await offer();const row=(await pool.query('SELECT * FROM offers WHERE id=$1',[o.offerId])).rows[0];
  assert.ok(Math.abs(row.expires_at-row.created_at-7200000)<10);
  await admin.query(`INSERT INTO slots VALUES ('short','lee',statement_timestamp()+interval '25 hours',statement_timestamp()+interval '25 hours 30 minutes','follow-up','video','Clinic video portal')`);
  const short=await execute('staff',{kind:'send',id:'short',waitlistId:'wait-jordan',reason:'Available sooner'});
  const shortened=(await pool.query("SELECT o.expires_at=s.starts_at-interval '24 hours' AS exact FROM offers o JOIN slots s ON s.id=o.slot_id WHERE o.id=$1",[short.offerId])).rows[0];assert.equal(shortened.exact,true);
  await admin.query(`INSERT INTO slots VALUES ('late','lee',statement_timestamp()+interval '20 hours',statement_timestamp()+interval '20 hours 30 minutes','follow-up','video','Clinic video portal')`);
  await assert.rejects(execute('staff',{kind:'send',id:'late',waitlistId:'wait-jordan'}),/cutoff/);
});
test('database constraints protect duplicate bookings, overlaps, exclusive offers and immutable audit',async()=>{
  const o=await offer();
  await assert.rejects(pool.query("INSERT INTO appointments(patient_id,slot_id,starts_at,ends_at,status) SELECT 'jordan',slot_id,starts_at,ends_at,'booked' FROM appointments WHERE slot_id='maya-old'"),/one_booking_per_slot/);
  await assert.rejects(pool.query("INSERT INTO slots SELECT 'overlap',clinician_id,starts_at,ends_at,visit_type,modality,location FROM slots WHERE id='maya-old'"),/exclusion constraint/);
  await assert.rejects(pool.query("INSERT INTO offers(slot_id,waitlist_id,source_appointment_id,source_version,patient_id,created_at,expires_at,status) SELECT slot_id,waitlist_id,source_appointment_id,source_version,patient_id,created_at,expires_at,'pending' FROM offers WHERE id=$1",[o.offerId]),/exclusive_/);
  await assert.rejects(pool.query("UPDATE audit SET action='changed'"),/permission denied/);
  await assert.rejects(pool.query('DELETE FROM audit'),/permission denied/);
  await admin.query("INSERT INTO slots SELECT 'patient-overlap','patel',starts_at,ends_at,visit_type,modality,location FROM slots WHERE id='maya-old'");
  await assert.rejects(pool.query("INSERT INTO appointments(patient_id,slot_id,starts_at,ends_at,status) SELECT 'maya',id,starts_at,ends_at,'booked' FROM slots WHERE id='patient-overlap'"),/exclusion constraint/);
});

test('an unrelated slow refresh holds the shared lock and blocks acceptance',async t=>{
  const o=await offer();
  const blocker=await admin.connect();const pending:Promise<PromiseSettledResult<unknown>>[]=[];
  const settle=(p:Promise<unknown>)=>p.then(value=>({status:'fulfilled' as const,value}),reason=>({status:'rejected' as const,reason}));
  async function waiting(query:string) {
    const until=Date.now()+2000;
    do {
      const row=(await admin.query(`SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
        WHERE datname=current_database() AND application_name='recovery-race-tests'
        AND state='active' AND wait_event_type='Lock' AND query LIKE $1`,[query])).rows[0];
      if(row)return row;
      await new Promise(resolve=>setTimeout(resolve,10));
    }while(Date.now()<until);
    assert.fail('Expected observed lock wait on a distinct database connection');
  }
  try {
    await blocker.query('BEGIN');await blocker.query('LOCK TABLE clinicians IN ACCESS EXCLUSIVE MODE');
    // Hold a real refresh partway through its reads, AFTER it acquired the
    // advisory lock. No production hooks or artificial query delay are used.
    pending.push(settle(getState('sam')));const reader=await waiting('%JOIN clinicians%');
    pending.push(settle(execute('maya',{kind:'accept',id:o.offerId!})));const acceptor=await waiting('%pg_advisory_xact_lock(710428)%');
    assert.notEqual(reader.pid,acceptor.pid);assert.ok(acceptor.blockers.includes(reader.pid));
    t.diagnostic(`Refresh PID ${reader.pid} directly blocks acceptance PID ${acceptor.pid}`);
  }finally{await blocker.query('ROLLBACK');blocker.release();await Promise.all(pending);}
  (await Promise.all(pending)).forEach(fulfilled);await assertMove(o.offerId!,true);
});
test('runtime audit privileges deny truncate and trigger removal as well as update/delete',async()=>{
  const role=(await pool.query('SELECT current_user AS name,r.rolsuper,r.rolcreatedb,r.rolcreaterole FROM pg_roles r WHERE rolname=current_user')).rows[0];
  assert.equal(role.name,'recovery_app');assert.equal(role.rolsuper,false);assert.equal(role.rolcreatedb,false);assert.equal(role.rolcreaterole,false);
  const grants=(await pool.query("SELECT has_table_privilege(current_user,'audit','SELECT,INSERT') AS append,has_table_privilege(current_user,'audit','UPDATE') AS update,has_table_privilege(current_user,'audit','DELETE') AS delete,has_table_privilege(current_user,'audit','TRUNCATE') AS truncate")).rows[0];
  assert.equal(grants.append,true);assert.equal(grants.update,false);assert.equal(grants.delete,false);assert.equal(grants.truncate,false);
  await assert.rejects(pool.query('TRUNCATE audit'),/permission denied/);
  await assert.rejects(pool.query('ALTER TABLE audit DISABLE TRIGGER audit_append_only'),/must be owner/);
  const count=(await admin.query('SELECT count(*)::int AS n FROM audit')).rows[0].n;
  await assert.rejects(admin.query("UPDATE audit SET action='changed'"),/append-only/);
  await assert.rejects(admin.query('DELETE FROM audit'),/append-only/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM audit')).rows[0].n,count);
});


test('restricted hosted table grants permit the complete move and deny slot editing and audit deletion',async()=>{
  await admin.query(readFileSync(new URL('../db/runtime_role_grants.sql',import.meta.url),'utf8'));
  try{
    const o=await offer();const result=await execute('maya',{kind:'accept',id:o.offerId!});
    assert.equal(result.appointment.slot_id,'opening');await assertMove(o.offerId!,true);
    await assert.rejects(pool.query("UPDATE slots SET location='changed' WHERE id='opening'"),/permission denied/);
    await assert.rejects(pool.query('DELETE FROM audit'),/permission denied/);
    await assert.rejects(pool.query("UPDATE identities SET role='staff' WHERE id='maya'"),/permission denied/);
  }finally{
    await admin.query('GRANT SELECT,INSERT,UPDATE,DELETE ON identities,sessions,clinicians,slots,appointments,waitlist,offers TO recovery_app');
  }
});


test('public budgets are atomic across connections, bounded and renew after their window',async()=>{
  const {consumePublicBudget}=await import('../lib/request-limits');
  await admin.query('TRUNCATE request_limits');
  const results=await Promise.allSettled(Array.from({length:25},()=>consumePublicBudget('signin')));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,20);
  for(const r of results.filter(r=>r.status==='rejected'))assert.equal(r.reason.status,429);
  assert.equal((await pool.query("SELECT used FROM request_limits WHERE kind='signin'")).rows[0].used,20);
  await admin.query("UPDATE request_limits SET started_at=clock_timestamp()-interval '61 seconds'");
  await consumePublicBudget('signin');
  assert.equal((await pool.query("SELECT used FROM request_limits WHERE kind='signin'")).rows[0].used,1);
  await consumePublicBudget('state');await consumePublicBudget('action');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM request_limits')).rows[0].n,3);
});
test('expired-session cleanup retains live sessions, appointments and audit',async()=>{
  const {cleanupExpiredSessions}=await import('../lib/request-limits');
  const before=(await admin.query("SELECT (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM appointments a) AS bookings,(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit a) AS audit")).rows[0];
  await pool.query("INSERT INTO sessions VALUES('expired-test','maya',clock_timestamp()-interval '1 second'),('live-test','staff',clock_timestamp()+interval '1 hour')");
  await cleanupExpiredSessions();
  assert.deepEqual((await pool.query('SELECT token_hash FROM sessions')).rows,[{token_hash:'live-test'}]);
  assert.deepEqual((await admin.query("SELECT (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM appointments a) AS bookings,(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit a) AS audit")).rows[0],before);
});
