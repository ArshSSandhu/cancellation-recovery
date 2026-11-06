import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {Announcements,OpeningCard,PatientView,StaffAppointments,type Appointment,type Offer,type Opening} from '../app/ui';
const run=async()=>{};
const start='2026-11-18T15:00:00Z',now='2026-11-05T05:00:00Z';
const booked:Appointment={id:'current',slot_id:'old',status:'booked',starts_at:start,ends_at:'2026-11-18T15:30:00Z',patient_name:'Current Patient',clinician_name:'Dr. Lee',modality:'video',location:'Clinic video portal'};
const offer:Offer={id:'offer',status:'pending',patient_name:'Current Patient',starts_at:'2026-11-08T15:00:00Z',ends_at:'2026-11-08T15:30:00Z',old_starts_at:start,source_status:'booked',expires_at:'2026-11-05T07:00:00Z',clinician_name:'Dr. Lee',modality:'video',location:'Clinic video portal',selection_reason:'Longest waiting',result_appointment_id:null};
const opening:Opening={id:'opening',starts_at:offer.starts_at,ends_at:offer.ends_at,clinician_name:'Dr. Lee',modality:'video',location:'Clinic video portal',preview_deadline:offer.expires_at,server_now:now,candidates:[],excluded:[{waitlist_id:'w',name:'Excluded Patient',reasons:['Different clinician.']}],activeOffer:null};
test('staff default region contains current bookings; history is retained in a closed disclosure',()=>{
  const html=renderToStaticMarkup(<StaffAppointments appointments={[booked,{...booked,id:'cancelled',status:'cancelled',patient_name:'Cancelled Patient'},{...booked,id:'replaced',status:'replaced',patient_name:'Replaced Patient'}]} run={run} busy={false}/>);
  const current=html.slice(0,html.indexOf('</section>'));
  assert.match(current,/Current Patient/);assert.doesNotMatch(current,/Cancelled Patient|Replaced Patient/);
  assert.match(html,/<details class="appointment-history"><summary>/);assert.doesNotMatch(html,/<details[^>]*\sopen[\s=>]/);
  assert.match(html,/Cancelled Patient/);assert.match(html,/Replaced Patient/);
});
test('no-match opening prioritizes the empty state and actual exclusions without a send action or deadline preview',()=>{
  const html=renderToStaticMarkup(<OpeningCard slot={opening} run={run} busy={false}/>);
  assert.match(html,/No eligible waiting patients/);assert.match(html,/Different clinician/);
  assert.ok(html.indexOf('No eligible waiting patients')<html.indexOf('Offer timing rules'));
  assert.doesNotMatch(html,/If offered now|Send exclusive offer|Deadline preview/);
});
test('eligible shortened window keeps an exact zoned reply deadline and plain scheduling wording',()=>{
  const html=renderToStaticMarkup(<OpeningCard slot={{...opening,preview_deadline:'2026-11-05T06:00:00Z',candidates:[{waitlist_id:'w1',name:'Patient',old_starts_at:start,joined_at:now,reasons:['Same clinician']}]}} run={run} busy={false}/>);
  assert.match(html,/Shortened reply window/);assert.match(html,/1:00:00 AM EST/);assert.match(html,/Send exclusive offer/);
  assert.doesNotMatch(html,/send time|server|24 hours\)/);
  const normal=renderToStaticMarkup(<OpeningCard slot={{...opening,candidates:[{waitlist_id:'w1',name:'Patient',old_starts_at:start,joined_at:now,reasons:['Same clinician']}]}} run={run} busy={false}/>);
  assert.match(normal,/Up to two hours to reply/);assert.match(normal,/2:00:00 AM EST/);assert.doesNotMatch(normal,/Shortened reply window|send time/);
});
test('patient pending offer has reply actions and a confirmed original appointment',()=>{
  const html=renderToStaticMarkup(<PatientView appointments={[booked]} offers={[offer]} uncertain={false} nowMs={Date.parse(now)} run={run} busy={false}/>);
  assert.match(html,/Your reply is needed/);assert.match(html,/Still confirmed/);assert.match(html,/Accept earlier appointment/);assert.match(html,/Keep existing appointment/);assert.match(html,/2:00:00 AM EST/);
});
for(const status of ['accepted','revoked','expired'])test(`patient ${status} offer states available action accurately`,()=>{
  const html=renderToStaticMarkup(<PatientView appointments={[booked]} offers={[{...offer,status,source_status:status==='accepted'?'replaced':'booked'}]} uncertain={false} nowMs={Date.parse(now)} run={run} busy={false}/>);
  assert.doesNotMatch(html,/>Accept earlier appointment<|>Keep existing appointment<|>Retry acceptance</);
  assert.match(html,status==='accepted'?/No reply needed/:/No reply available/);
  if(status==='accepted')assert.match(html,/Check recorded acceptance/);
  if(status==='revoked')assert.match(html,/Offer withdrawn by the clinic/);
  if(status==='expired')assert.match(html,/This offer has expired/);
});
test('uncertain acceptance makes no confirmed-original claim and preserves safe retry',()=>{
  const html=renderToStaticMarkup(<PatientView appointments={[booked]} offers={[offer]} uncertain={true} nowMs={Date.parse(now)} run={run} busy={false}/>);
  assert.match(html,/Last loaded booking · status unconfirmed/);assert.doesNotMatch(html,/Still confirmed|Your reply is needed/);
  assert.match(html,/Retry acceptance/);assert.match(html,/disabled="">Keep existing appointment/);
});
test('elapsed pending deadline removes reply actions and requests a fresh authoritative status',()=>{
  const html=renderToStaticMarkup(<PatientView appointments={[booked]} offers={[offer]} uncertain={false} nowMs={Date.parse(offer.expires_at)} run={run} busy={false}/>);
  assert.match(html,/Reply deadline has passed/);assert.match(html,/Refresh records to check the latest/);assert.doesNotMatch(html,/Accept earlier appointment|Keep existing appointment|did not move your appointment/);
});
test('unknown outcome isolates the affected offer and does not suggest acceptance after a lost decline',()=>{
  const html=renderToStaticMarkup(<PatientView appointments={[booked]} offers={[{...offer,id:'previous',status:'revoked'},offer]} uncertain={true} uncertainOfferId="offer" retryAcceptance={false} nowMs={Date.parse(now)} run={run} busy={false}/>);
  assert.doesNotMatch(html,/Retry acceptance|Offer withdrawn by the clinic/);
  assert.match(html,/Refresh records to check whether your response was recorded/);assert.match(html,/Refresh records to see your other offers/);
});
test('announcements have persistent atomic status and alert regions for dynamic updates',()=>{
  const idle=renderToStaticMarkup(<Announcements notice={null} busy={false}/>);
  assert.match(idle,/role="status" aria-live="polite" aria-atomic="true"/);assert.match(idle,/role="alert" aria-live="assertive" aria-atomic="true"/);
  assert.match(renderToStaticMarkup(<Announcements notice={{text:'Could not confirm',error:true}} busy={false}/>),/role="alert"[^>]*>Could not confirm/);
});
