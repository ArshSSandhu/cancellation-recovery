import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction } from './db';

export class WorkflowError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
const requireThat: (condition: unknown, message: string, status?: number) => asserts condition = (condition, message, status) => {
  if (!condition) throw new WorkflowError(message, status);
};
export async function audit(c: PoolClient, actor: string | null, action: string, entity: string, details: object, requestId = randomUUID()) {
  await c.query('INSERT INTO audit(actor_id,action,entity_id,request_id,details) VALUES ($1,$2,$3,$4,$5)', [actor,action,entity,requestId,JSON.stringify(details)]);
}
async function expire(c: PoolClient) {
  const expired = await c.query("UPDATE offers SET status='expired' WHERE status='pending' AND expires_at <= clock_timestamp() RETURNING id");
  for (const offer of expired.rows) await audit(c,null,'offer.expired',offer.id,{ reason:'Deadline reached' });
}
async function identity(c: PoolClient, id: string) {
  const actor = (await c.query('SELECT * FROM identities WHERE id=$1',[id])).rows[0];
  requireThat(actor,'Please sign in.',401); return actor as {id:string; name:string; role:'staff'|'patient'};
}
export const matchReasons = ['Same clinician','Same follow-up type and duration','Same modality and location','Earlier than existing booking','Within requested availability','Staff cleared and opted in','No overlapping appointment'];

// The eligibility decision and staff explanations share these exact predicates.
// These SQL expressions are fixed source code; all record identifiers remain parameters.
const matchingRules = [
  ['active_waitlist', "w.status='active'", 'Patient is no longer on this waitlist.'],
  ['opted_in', 'w.opted_in', 'Patient has not opted in to earlier-visit offers.'],
  ['cleared', 'w.cleared', 'Staff scheduling clearance is not recorded.'],
  ['booked_original', "a.status='booked'", 'The original appointment is no longer booked.'],
  ['patient_identity', "i.role='patient'", 'This identity is not a patient.'],
  ['same_clinician', 'old.clinician_id=target.clinician_id', 'Different clinician.'],
  ['same_type', 'old.visit_type=target.visit_type', 'Different visit type.'],
  ['same_modality', 'old.modality=target.modality', 'Different visit format (video or in-person).'],
  ['same_location', 'old.location=target.location', 'Different appointment location.'],
  ['same_duration', 'old.ends_at-old.starts_at=target.ends_at-target.starts_at', 'Different appointment length.'],
  ['earlier', 'target.starts_at < old.starts_at', 'This opening is not earlier than the existing appointment.'],
  ['before_cutoff', "target.starts_at > clock_timestamp()+interval '24 hours'", 'The reply cutoff 24 hours before the visit has passed.'],
  ['available', 'target.starts_at >= w.available_from AND target.ends_at <= w.available_until', 'Outside the patient’s requested availability.'],
  ['no_overlap', "NOT EXISTS (SELECT 1 FROM appointments conflict WHERE conflict.patient_id=a.patient_id AND conflict.status='booked' AND tstzrange(conflict.starts_at,conflict.ends_at,'[)') && tstzrange(target.starts_at,target.ends_at,'[)'))", 'Patient already has an appointment at this time.'],
  ['no_active_offer', "NOT EXISTS (SELECT 1 FROM offers o WHERE o.source_appointment_id=a.id AND o.id IS DISTINCT FROM $2::uuid AND o.status='pending' AND o.expires_at>clock_timestamp())", 'An offer is already active for this appointment.'],
  ['no_prior_offer', "NOT EXISTS (SELECT 1 FROM offers o WHERE o.patient_id=a.patient_id AND o.slot_id=target.id AND o.status IN ('declined','expired','revoked'))", 'A previous offer for this opening was unsuccessful.'],
] as const;
export async function assessCandidates(c:PoolClient, slotId:string, ignoredOfferId:string|null=null) {
  const checks=matchingRules.map(([key,sql])=>`(${sql}) AS ${key}`).join(', ');
  const result=await c.query(`SELECT w.id AS waitlist_id,w.joined_at,w.status AS waitlist_status,a.id AS appointment_id,
    a.version,a.patient_id,a.status AS source_status,i.name,a.starts_at AS old_starts_at,a.ends_at AS old_ends_at,
    (SELECT o.status FROM offers o WHERE o.patient_id=a.patient_id AND o.slot_id=target.id AND o.status IN ('declined','expired','revoked') ORDER BY o.created_at DESC,o.id LIMIT 1) AS previous_offer_status,
    ${checks} FROM waitlist w JOIN appointments a ON a.id=w.appointment_id
    JOIN identities i ON i.id=a.patient_id JOIN slots old ON old.id=a.slot_id
    JOIN slots target ON target.id=$1 ORDER BY w.joined_at,w.id`,[slotId,ignoredOfferId]);
  return result.rows.map(row=>{
    const exclusionReasons=matchingRules.flatMap(([key,,reason])=>{
      if(row[key]===true)return [];
      if(key==='active_waitlist'&&row.waitlist_status==='completed')return ['This waitlist request is already completed.'];
      if(key==='booked_original'&&row.source_status==='replaced')return ['The original appointment has been replaced.'];
      if(key==='booked_original'&&row.source_status==='cancelled')return ['The original appointment was cancelled.'];
      if(key==='no_prior_offer') {
        const outcome:Record<string,string>={declined:'declined by the patient',expired:'not accepted before its deadline',revoked:'withdrawn by the clinic'};
        if(outcome[row.previous_offer_status])return [`A previous offer for this opening was ${outcome[row.previous_offer_status]}.`];
      }
      return [reason];
    });
    return {...row,eligible:exclusionReasons.length===0,exclusionReasons,reasons:matchReasons};
  });
}
export async function eligible(c:PoolClient, slotId:string, ignoredOfferId:string|null=null) {
  return (await assessCandidates(c,slotId,ignoredOfferId)).filter(row=>row.eligible);
}

export type Command = {kind:'cancel'|'send'|'accept'|'decline'|'revoke'; id:string; waitlistId?:string; reason?:string};
export async function execute(actorId: string, command: Command) {
  return transaction(async c => {
    const actor = await identity(c,actorId);
    if (['cancel','send','revoke'].includes(command.kind)) requireThat(actor.role==='staff','Staff access required.',403);
    else requireThat(actor.role==='patient','Patient access required.',403);
    await expire(c);
    const requestId = randomUUID();
    if (command.kind==='cancel') {
      const appointment = (await c.query("SELECT * FROM appointments WHERE id=$1 FOR UPDATE",[command.id])).rows[0];
      requireThat(appointment,'Appointment not found.',404);
      requireThat(appointment.status==='booked','This appointment is no longer booked.');
      requireThat(appointment.starts_at > new Date(),'Only future appointments can be cancelled.');
      requireThat(command.reason?.trim(),'Record a cancellation reason.',400);
      await c.query("UPDATE appointments SET status='cancelled',version=version+1 WHERE id=$1",[command.id]);
      await c.query("UPDATE waitlist SET status='removed' WHERE appointment_id=$1",[command.id]);
      const revoked = await c.query("UPDATE offers SET status='revoked' WHERE source_appointment_id=$1 AND status='pending' RETURNING id",[command.id]);
      for (const o of revoked.rows) await audit(c,actorId,'offer.revoked',o.id,{reason:'Original appointment cancelled'},requestId);
      await audit(c,actorId,'appointment.cancelled',command.id,{slotId:appointment.slot_id,patientId:appointment.patient_id,before:'booked',after:'cancelled',reason:command.reason!.trim()},requestId);
      return {message:'Appointment cancelled. The opening is ready for review.'};
    }
    if (command.kind==='send') {
      const slot = (await c.query('SELECT * FROM slots WHERE id=$1 FOR UPDATE',[command.id])).rows[0];
      requireThat(slot,'Opening not found.',404);
      const timing = (await c.query("SELECT starts_at>clock_timestamp()+interval '24 hours' AS valid FROM slots WHERE id=$1",[slot.id])).rows[0];
      requireThat(timing.valid,'The cutoff 24 hours before this visit has passed.');
      requireThat(!(await c.query("SELECT 1 FROM appointments WHERE slot_id=$1 AND status='booked'",[slot.id])).rowCount,'This opening is already booked.');
      requireThat(!(await c.query("SELECT 1 FROM offers WHERE slot_id=$1 AND status='pending'",[slot.id])).rowCount,'This opening already has an exclusive offer.');
      const candidates = await eligible(c,slot.id);
      const chosen = candidates.find(x=>x.waitlist_id===command.waitlistId);
      requireThat(chosen,'This patient is no longer eligible.');
      const override = chosen.waitlist_id !== candidates[0].waitlist_id;
      requireThat(!override || command.reason?.trim(),'Record why you chose someone other than the longest-waiting patient.',400);
      const offer = (await c.query(`INSERT INTO offers(slot_id,waitlist_id,source_appointment_id,source_version,patient_id,created_at,expires_at,status,selection_reason)
        SELECT $1,$2,$3,$4,$5,t.sent_at,LEAST(t.sent_at+interval '2 hours',s.starts_at-interval '24 hours'),'pending',$6
        FROM slots s CROSS JOIN (SELECT clock_timestamp() AS sent_at) t WHERE s.id=$1 AND s.starts_at-interval '24 hours'>t.sent_at RETURNING *`,[slot.id,chosen.waitlist_id,chosen.appointment_id,chosen.version,chosen.patient_id,override?command.reason!.trim():'Longest-waiting eligible patient'])).rows[0];
      requireThat(offer,'The cutoff 24 hours before this visit has passed.');
      await audit(c,actorId,'offer.sent',offer.id,{slotId:slot.id,patientId:chosen.patient_id,sourceAppointmentId:chosen.appointment_id,deadline:offer.expires_at,selectionReason:offer.selection_reason,policyVersion:'v1',matchReasons},requestId);
      return {message:'Exclusive offer sent to the simulated inbox.',offerId:offer.id};
    }
    const offer = (await c.query('SELECT * FROM offers WHERE id=$1 FOR UPDATE',[command.id])).rows[0];
    // Conceal other patients' records, including their status.
    requireThat(offer && (actor.role==='staff' || offer.patient_id===actorId),'Offer not found.',404);
    if (command.kind==='accept' && offer.status==='accepted') {
      const result = (await c.query('SELECT * FROM appointments WHERE id=$1',[offer.result_appointment_id])).rows[0];
      return {message:'This offer was already accepted. Here is the recorded booking.',appointment:result,replayed:true};
    }
    requireThat(offer.status==='pending',`This offer is ${offer.status}. This request did not change a booking. Refresh records to see the current booking.`);
    if (command.kind==='decline' || command.kind==='revoke') {
      if(command.kind==='revoke') requireThat(command.reason?.trim(),'Record a revocation reason.',400);
      const status = command.kind==='decline'?'declined':'revoked';
      await c.query('UPDATE offers SET status=$2 WHERE id=$1',[offer.id,status]);
      await audit(c,actorId,`offer.${status}`,offer.id,{reason:command.reason?.trim()??'Patient kept existing appointment',sourceAppointmentId:offer.source_appointment_id},requestId);
      return {message:command.kind==='decline'?'Offer declined. Your existing appointment is still booked.':'Offer revoked. The patient’s existing booking is unchanged.'};
    }
    const source = (await c.query('SELECT * FROM appointments WHERE id=$1 FOR UPDATE',[offer.source_appointment_id])).rows[0];
    const slot = (await c.query('SELECT * FROM slots WHERE id=$1 FOR UPDATE',[offer.slot_id])).rows[0];
    requireThat(source.status==='booked' && source.version===offer.source_version,'Your original booking changed after this offer was sent. This acceptance did not change it. Refresh records to see the current booking.');
    // Recheck every matching rule, excluding this offer from the active-offer check.
    const candidates = await eligible(c,slot.id,offer.id);
    requireThat(candidates.some(x=>x.appointment_id===source.id),'You are no longer eligible for this opening. Your existing booking is unchanged.');
    requireThat(!(await c.query("SELECT 1 FROM appointments WHERE slot_id=$1 AND status='booked'",[slot.id])).rowCount,'This opening is no longer available. Your existing booking is unchanged.');
    // Final wall-clock check occurs after waiting/validation, immediately before booking writes.
    requireThat((await c.query("SELECT o.expires_at>clock_timestamp() AND s.starts_at>clock_timestamp()+interval '24 hours' AS valid FROM offers o JOIN slots s ON s.id=o.slot_id WHERE o.id=$1",[offer.id])).rows[0].valid,'This offer expired. Your existing booking is unchanged.');
    const booking = (await c.query(`INSERT INTO appointments(patient_id,slot_id,starts_at,ends_at,status) SELECT $1,id,starts_at,ends_at,'booked' FROM slots WHERE id=$2 RETURNING *`,[actorId,slot.id])).rows[0];
    await c.query("UPDATE appointments SET status='replaced',replacement_id=$2,version=version+1 WHERE id=$1",[source.id,booking.id]);
    await c.query("UPDATE offers SET status='accepted',result_appointment_id=$2 WHERE id=$1",[offer.id,booking.id]);
    await c.query("UPDATE waitlist SET status='completed' WHERE id=$1",[offer.waitlist_id]);
    await audit(c,actorId,'appointment.moved',booking.id,{offerId:offer.id,fromAppointmentId:source.id,fromSlotId:source.slot_id,toSlotId:slot.id,from:source.starts_at,to:slot.starts_at,sourceAfter:'replaced'},requestId);
    return {message:'Confirmed. Your appointment has moved and the previous time has been released.',appointment:booking,replayed:false};
  });
}

export async function getState(actorId:string) {
  return transaction(async c=>{
    const actor=await identity(c,actorId); await expire(c);
    const appointments=(await c.query(`SELECT a.*,i.name AS patient_name,s.clinician_id,s.modality,s.location,cl.name AS clinician_name
      FROM appointments a JOIN identities i ON i.id=a.patient_id JOIN slots s ON s.id=a.slot_id JOIN clinicians cl ON cl.id=s.clinician_id
      WHERE ($1::boolean OR a.patient_id=$2) ORDER BY a.starts_at`,[actor.role==='staff',actorId])).rows;
    const offers=(await c.query(`SELECT o.*,i.name AS patient_name,s.starts_at,s.ends_at,s.modality,s.location,cl.name AS clinician_name,
      a.starts_at AS old_starts_at,a.ends_at AS old_ends_at,a.status AS source_status
      FROM offers o JOIN identities i ON i.id=o.patient_id JOIN slots s ON s.id=o.slot_id JOIN clinicians cl ON cl.id=s.clinician_id
      JOIN appointments a ON a.id=o.source_appointment_id
      WHERE ($1::boolean OR o.patient_id=$2) ORDER BY o.created_at DESC`,[actor.role==='staff',actorId])).rows;
    const openings=[];
    if(actor.role==='staff') {
      const slots=(await c.query(`SELECT s.*,cl.name AS clinician_name, clock_timestamp() AS server_now,
        LEAST(clock_timestamp()+interval '2 hours',s.starts_at-interval '24 hours') AS preview_deadline
        FROM slots s JOIN clinicians cl ON cl.id=s.clinician_id
        WHERE s.starts_at>clock_timestamp() AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.slot_id=s.id AND a.status='booked') ORDER BY s.starts_at`)).rows;
      for(const slot of slots) {
        const assessed=await assessCandidates(c,slot.id);
        openings.push({...slot,candidates:assessed.filter(row=>row.eligible),
          excluded:assessed.filter(row=>!row.eligible).map(row=>({waitlist_id:row.waitlist_id,name:row.name,reasons:row.exclusionReasons})),
          activeOffer:offers.find(o=>o.slot_id===slot.id&&o.status==='pending')??null});
      }
    }
    const history=actor.role==='staff'?(await c.query(`SELECT au.*,COALESCE(i.name,'System') AS actor_name FROM audit au LEFT JOIN identities i ON i.id=au.actor_id ORDER BY au.id DESC LIMIT 100`)).rows:[];
    return {actor,appointments,offers,openings,audit:history,timeZone:'America/Indiana/Indianapolis',serverNow:(await c.query('SELECT clock_timestamp() AS now')).rows[0].now};
  });
}
