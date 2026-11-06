'use client';
import {useEffect,useRef,useState} from 'react';

export type Appointment={id:string;slot_id:string;status:string;starts_at:string;ends_at:string;patient_name:string;clinician_name:string;modality:string;location:string};
export type Offer={id:string;status:string;patient_name:string;starts_at:string;ends_at:string;old_starts_at:string;source_status:string;expires_at:string;clinician_name:string;modality:string;location:string;selection_reason:string;result_appointment_id:string|null};
type Candidate={waitlist_id:string;name:string;old_starts_at:string;joined_at:string;reasons:string[]};
export type Opening={id:string;starts_at:string;ends_at:string;clinician_name:string;modality:string;location:string;preview_deadline:string;server_now:string;candidates:Candidate[];excluded:{waitlist_id:string;name:string;reasons:string[]}[];activeOffer:Offer|null};
type History={id:number;at:string;actor_name:string;action:string;entity_id:string;request_id:string;details:Record<string,unknown>};
type State={actor:{id:string;name:string;role:string};appointments:Appointment[];offers:Offer[];openings:Opening[];audit:History[];serverNow:string};
export type Run=(command:Record<string,string>)=>Promise<void>;
type Notice={text:string;error:boolean}|null;
const zone='America/Indiana/Indianapolis';
const date=(s:string,exact=false)=>new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',...(exact?{second:'2-digit' as const}:{}),timeZoneName:'short'}).format(new Date(s));
const identities=[['staff','Alex Morgan · Staff'],['maya','Maya Chen · Patient'],['jordan','Jordan Ellis · Patient'],['sam','Sam Rivera · Patient'],['casey','Casey Park · Patient']];
const statusLabels:Record<string,string>={pending:'Awaiting reply',revoked:'Withdrawn',expired:'Expired',accepted:'Accepted',replaced:'Replaced',cancelled:'Cancelled',booked:'Confirmed',unconfirmed:'Unconfirmed','deadline-passed':'Reply deadline passed'};
function Badge({status}:{status:string}){return <span className={`badge ${status}`}>{statusLabels[status]??status}</span>;}

function Exclusions({slot}:{slot:Opening}) {
  return <details className="exclusions"><summary>Why patients don’t match ({slot.excluded.length})</summary>
    <p className="muted small">These are the current reasons each waitlist entry is excluded.</p>
    {slot.excluded.length?slot.excluded.map(patient=><div key={patient.waitlist_id} className="excluded-patient"><strong>{patient.name}</strong><ul>{patient.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></div>):<p>No excluded waitlist entries to show.</p>}
  </details>;
}
export function OpeningCard({slot,run,busy}:{slot:Opening;run:Run;busy:boolean}) {
  const [selected,setSelected]=useState(slot.candidates[0]?.waitlist_id??'');
  const [reason,setReason]=useState('');
  const candidate=slot.candidates.find(c=>c.waitlist_id===selected)??slot.candidates[0];
  const override=candidate&&candidate.waitlist_id!==slot.candidates[0]?.waitlist_id;
  const cutoffPassed=new Date(slot.preview_deadline)<=new Date(slot.server_now);
  const shortened=new Date(slot.preview_deadline).getTime()<new Date(slot.server_now).getTime()+7_199_000;
  const noMatch=!slot.candidates.length;
  return <article className="card opening" aria-label={`Opening ${date(slot.starts_at)}`}>
    <div className="row"><span className="eyebrow">Available opening</span><Badge status={slot.activeOffer?'held':'open'}/></div>
    <h3>{date(slot.starts_at)}</h3><p>{slot.clinician_name} · 30-minute follow-up · {slot.modality}</p><p className="muted">{slot.location}</p>
    {slot.activeOffer?<div className="notice"><strong>Held exclusively for {slot.activeOffer.patient_name}</strong><p>Reply by {date(slot.activeOffer.expires_at,true)}</p><p>Waiting for the patient’s response. Their existing appointment remains booked.</p></div>:cutoffPassed?<>
      <div className="notice warning"><strong>This opening can no longer be offered</strong><p>Offers close 24 hours before the visit.</p></div><Exclusions slot={slot}/>
    </>:noMatch?<>
      <div className="no-match"><h4>No eligible waiting patients</h4><p>There is nobody to offer this opening to under the current scheduling rules.</p></div>
      <Exclusions slot={slot}/>
      <details className="timing-details"><summary>Offer timing rules</summary><p>Patients normally have up to two hours to reply. All replies must arrive at least 24 hours before the visit.</p></details>
    </>:<>
      <h4>Eligible patients ({slot.candidates.length})</h4><p className="muted small">Longest-waiting first. Choose another eligible patient only with a recorded reason.</p>
      <form onSubmit={e=>{e.preventDefault();if(candidate)void run({kind:'send',id:slot.id,waitlistId:candidate.waitlist_id,reason});}}>
        <fieldset disabled={busy}><legend className="sr-only">Choose a patient for this opening</legend>
          {slot.candidates.map((c,index)=><label className={`candidate ${candidate?.waitlist_id===c.waitlist_id?'selected':''}`} key={c.waitlist_id}>
            <input type="radio" name={`candidate-${slot.id}`} checked={candidate?.waitlist_id===c.waitlist_id} onChange={()=>setSelected(c.waitlist_id)}/>
            <span><strong>{c.name}</strong> {index===0&&<span className="recommended">Longest waiting</span>}<br/><span className="small">Waiting since {date(c.joined_at)}<br/>Currently booked: {date(c.old_starts_at)}</span><span className="reasons">{c.reasons.map(r=><span key={r}>✓ {r}</span>)}</span></span>
          </label>)}
          {override&&<label className="field">Reason for choosing another eligible patient (required)<input required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Record the scheduling reason"/></label>}
          <div className={`notice ${shortened?'warning':''}`}><strong>{shortened?'Shortened reply window':'Up to two hours to reply'}</strong>
            <p>Reply deadline preview: <strong>{date(slot.preview_deadline,true)}</strong></p>
            <p>{shortened?'There is less than two hours left before offers close for this visit.':'The patient’s existing booking stays in place while they decide.'} The final reply deadline will be shown after the offer is sent. Refresh records to update this preview.</p>
          </div>
          <button disabled={busy||!candidate||!!override&&!reason.trim()}>Send exclusive offer to {candidate?.name}</button>
        </fieldset>
      </form><Exclusions slot={slot}/>
    </>}
  </article>;
}
function Revoke({offer,run,busy}:{offer:Offer;run:Run;busy:boolean}) {
  const [reason,setReason]=useState('');
  return <form className="inline-form" onSubmit={e=>{e.preventDefault();void run({kind:'revoke',id:offer.id,reason});}}><label className="field">Reason for withdrawing this offer<input required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Why is this offer being withdrawn?"/></label><button className="secondary" disabled={busy||!reason.trim()}>Withdraw offer</button></form>;
}
function Cancel({appointment,run,busy}:{appointment:Appointment;run:Run;busy:boolean}) {
  const [reason,setReason]=useState('');
  return <form className="inline-form" onSubmit={e=>{e.preventDefault();void run({kind:'cancel',id:appointment.id,reason});}}><label className="field">Cancellation reason<input required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. Patient cancelled"/></label><button className="secondary" disabled={busy||!reason.trim()}>Cancel appointment</button></form>;
}
function AppointmentRecord({appointment:a,run,busy}:{appointment:Appointment;run:Run;busy:boolean}) {
  return <article className="appointment"><div><div className="row"><h3>{a.patient_name}</h3><Badge status={a.status}/></div><p><strong>{date(a.starts_at)}</strong></p><p>{a.clinician_name} · {a.modality} · 30-minute follow-up</p>{a.status==='replaced'&&<p className="muted">Previous time released after a replacement was confirmed.</p>}</div>{a.status==='booked'&&<Cancel appointment={a} run={run} busy={busy}/>}</article>;
}
export function StaffAppointments({appointments,run,busy}:{appointments:Appointment[];run:Run;busy:boolean}) {
  const current=appointments.filter(a=>a.status==='booked');
  const history=appointments.filter(a=>a.status==='cancelled'||a.status==='replaced');
  return <>
    <section aria-label="Current bookings"><div className="section-title"><h2>Current bookings</h2><span>{current.length} confirmed</span></div>
      {current.length?<div className="card appointment-list">{current.map(a=><AppointmentRecord key={a.id} appointment={a} run={run} busy={busy}/>)}</div>:<div className="empty">No current bookings are listed.</div>}
    </section>
    <details className="appointment-history"><summary>Appointment history · cancelled and replaced ({history.length})</summary>
      <p className="muted">These appointments are no longer booked. Their records and audit history are retained.</p>
      {history.length?<div className="card appointment-list">{history.map(a=><AppointmentRecord key={a.id} appointment={a} run={run} busy={busy}/>)}</div>:<p>No cancelled or replaced appointments.</p>}
    </details>
  </>;
}
export function Announcements({notice,busy}:{notice:Notice;busy:boolean}) {
  return <>
    <div role="status" aria-live="polite" aria-atomic="true" className={notice&&!notice.error?'message success':undefined}>{notice&&!notice.error?notice.text:busy?'Updating records…':''}</div>
    <div role="alert" aria-live="assertive" aria-atomic="true" className={notice?.error?'message error':undefined}>{notice?.error?notice.text:''}</div>
  </>;
}
export function PatientView({appointments,offers,uncertain,uncertainOfferId,retryAcceptance=true,nowMs,run,busy}:{appointments:Appointment[];offers:Offer[];uncertain:boolean;uncertainOfferId?:string;retryAcceptance?:boolean;nowMs:number;run:Run;busy:boolean}) {
  const current=appointments.filter(a=>a.status==='booked');
  const shownOffers=uncertain&&uncertainOfferId?offers.filter(o=>o.id===uncertainOfferId):offers;
  return <>
    <section aria-label={uncertain?'Last loaded booking, status unconfirmed':'Confirmed appointments'}><h2>{uncertain?'Last loaded booking · status unconfirmed':'Your confirmed appointments'}</h2>
      {current.length?current.map(a=><article className="card booked-card" key={a.id}><Badge status={uncertain?'unconfirmed':'booked'}/><h3>{date(a.starts_at)}</h3><p>{a.clinician_name} · 30-minute follow-up · {a.modality}</p><p className="muted">{a.location}</p></article>):<div className="empty">No confirmed appointments are listed. Contact the clinic to check your next visit.</div>}
    </section>
    <section aria-label="Simulated inbox"><div className="section-title"><h2>Simulated inbox</h2><span>No email or SMS sent</span></div>
      {!offers.length?<div className="empty">No earlier-visit offers for you right now.</div>:shownOffers.map(o=>{
        const deadlinePassed=o.status==='pending'&&nowMs>=Date.parse(o.expires_at);
        const status=uncertain?'unconfirmed':deadlinePassed?'deadline-passed':o.status;
        const canReply=!uncertain&&o.status==='pending'&&!deadlinePassed;
        const title=uncertain?'Response status unconfirmed':deadlinePassed?'Reply deadline has passed':({pending:'An earlier visit is available',accepted:'Earlier visit accepted',revoked:'Offer withdrawn by the clinic',expired:'This offer has expired',declined:'You kept your existing appointment'}[o.status]??'Earlier-visit offer');
        return <article className="card patient-offer" key={o.id} aria-label={title}>
          <div className="row"><h3>{title}</h3><Badge status={status}/></div>
          {canReply&&<div className="notice"><strong>Your reply is needed</strong><p>Reply by <strong>{date(o.expires_at,true)}</strong>. Your current booking stays confirmed while you decide.</p></div>}
          {uncertain&&<div className="notice warning"><strong>The change may already have completed</strong><p>{retryAcceptance?'Refresh records or retry acceptance to recover the recorded result.':'Refresh records to check whether your response was recorded.'} The times below are from the last successful refresh.</p></div>}
          {!canReply&&!uncertain&&<div className={`notice ${o.status==='accepted'?'':'warning'}`}>
            <strong>{o.status==='accepted'?'No reply needed':'No reply available'}</strong>
            <p>{deadlinePassed?'Refresh records to check the latest offer and appointment status.':o.status==='accepted'?'This move was recorded. Your current appointment status is shown above.':`This offer ${o.status==='revoked'?'was withdrawn':o.status==='expired'?'expired':'was declined'} and did not move your appointment. Your current appointment status is shown above.`}</p>
          </div>}
          <div className="comparison"><div><span className="eyebrow">{uncertain?'Last loaded appointment':'Original appointment'}</span><h3>{date(o.old_starts_at)}</h3><p>{uncertain?'Booking status unconfirmed':o.source_status==='booked'?'Still confirmed':o.source_status==='replaced'?'Previous time released':'Cancelled'}</p></div>
            <div><span className="eyebrow">{o.status==='accepted'&&!uncertain?'Accepted time':'Earlier appointment'}</span><h3>{date(o.starts_at)}</h3><p>{o.clinician_name} · 30 minutes · {o.modality}</p><p>{o.location}</p></div>
          </div>
          {(canReply||(uncertain&&retryAcceptance))&&<><p>{uncertain?'Retrying acceptance retrieves the recorded result without repeating a completed move.':'Accepting moves this appointment and releases the original time. Keeping your existing appointment declines this offer.'}</p><div className="actions"><button disabled={busy} onClick={()=>void run({kind:'accept',id:o.id})}>{uncertain?'Retry acceptance':'Accept earlier appointment'}</button><button className="secondary" disabled={busy||uncertain} onClick={()=>void run({kind:'decline',id:o.id})}>Keep existing appointment</button></div></>}
          {o.status==='accepted'&&!uncertain&&<div className="actions"><button className="secondary" disabled={busy} onClick={()=>void run({kind:'accept',id:o.id})}>Check recorded acceptance</button></div>}
          {!canReply&&<details className="timing-details"><summary>Offer details</summary><p>Reply deadline: {date(o.expires_at,true)}</p></details>}
        </article>;
      })}
      {uncertain&&shownOffers.length<offers.length&&<p className="muted">Refresh records to see your other offers.</p>}
    </section>
  </>;
}
export default function Dashboard(){
  const [state,setState]=useState<State|null>(null);const [identity,setIdentity]=useState('staff');
  const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState<Notice>(null);const noticeRef=useRef<HTMLDivElement>(null);const announcedDeadlines=useRef(new Set<string>());
  const [tab,setTab]=useState('schedule');const [uncertain,setUncertain]=useState(false);const [uncertainCommand,setUncertainCommand]=useState<{kind:string;id:string}|null>(null);const [nowMs,setNowMs]=useState(0);
  async function load(){
    const response=await fetch('/api/state',{cache:'no-store'});const body=await response.json();
    if(response.ok){setState(body);setIdentity(body.actor.id);setUncertain(false);setUncertainCommand(null);setNowMs(Date.parse(body.serverNow));return true;}
    if(response.status===401){setState(null);return false;}
    throw new Error(body.error);
  }
  useEffect(()=>{void load().catch(e=>setNotice({text:e.message,error:true})).finally(()=>setLoading(false));},[]);
  useEffect(()=>{if(notice&&!busy)noticeRef.current?.focus();},[notice,busy]);
  useEffect(()=>{
    if(!state)return;
    const receivedAt=Date.now(),serverNow=Date.parse(state.serverNow);
    const timer=setInterval(()=>setNowMs(serverNow+Date.now()-receivedAt),1000);
    return ()=>clearInterval(timer);
  },[state?.serverNow]);
  useEffect(()=>{
    if(!state||state.actor.role!=='patient'||busy||uncertain)return;
    const crossed=state.offers.filter(o=>o.status==='pending'&&nowMs>=Date.parse(o.expires_at)&&!announcedDeadlines.current.has(o.id));
    if(crossed.length){
      crossed.forEach(o=>announcedDeadlines.current.add(o.id));
      setNotice({text:'The reply deadline has passed. Refresh records to check the latest offer and appointment status.',error:false});
    }
  },[state,nowMs,busy,uncertain]);
  async function login(){
    setBusy(true);setNotice(null);
    try{const r=await fetch('/api/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identityId:identity})});const b=await r.json();if(!r.ok)throw new Error(b.error);if(!await load())throw new Error('Please sign in again.');setTab('schedule');setNotice({text:'Signed in. Your records are ready.',error:false});}
    catch(e){setNotice({text:(e as Error).message,error:true});}finally{setBusy(false);}
  }
  async function refresh(){
    setBusy(true);setNotice(null);
    try{const ok=await load();setNotice({text:ok?'Records refreshed. The appointments below show the recorded booking.':'Please sign in again to check your records.',error:!ok});}
    catch{setNotice({text:'Records could not be refreshed. Previously loaded information may be out of date. Try refreshing again.',error:true});}finally{setBusy(false);}
  }
  const run:Run=async command=>{
    setBusy(true);setNotice(null);
    try{const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});const b=await r.json();await load();setNotice({text:b.error??b.message,error:!r.ok});}
    catch{setUncertain(true);setUncertainCommand({kind:command.kind,id:command.id});setNotice({text:command.kind==='accept'?'We couldn’t confirm whether the change completed. Refresh records or retry acceptance to recover the recorded result. The times below are from the last successful refresh.':'We couldn’t confirm whether the change completed. Refresh records to check the recorded result. Previously loaded information may be out of date.',error:true});}
    finally{setBusy(false);}
  };
  const staff=state?.actor.role==='staff';
  return <>
    <a className="skip-link" href="#main">Skip to appointments</a>
    <div className="demo-strip">FICTIONAL DATA ONLY <span>Local prototype · no real messages are sent</span></div>
    <header><a href="/" className="brand"><span className="brand-icon">↗</span> earlier<span className="brand-sub">Clinic scheduling</span></a><div className="identity"><label htmlFor="identity">Demo identity</label><select id="identity" value={identity} onChange={e=>setIdentity(e.target.value)}>{identities.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select><button className="secondary" disabled={busy} onClick={()=>void login()}>Sign in / switch</button></div></header>
    <main id="main" tabIndex={-1}>
      <div className="page-heading"><div><p className="eyebrow">Cancellation recovery</p><h1>{!state?'A little sooner.':staff?'Make room for an earlier visit.':`Your next visit, ${state.actor.name.split(' ')[0]}.`}</h1><p className="lede">{!state?'Sign in with a fictional identity to explore the clinic and patient experiences.':staff?'Review openings, match waiting patients, and follow every booking change.':uncertain?'Booking status is unconfirmed. Refresh records before relying on these times.':'Your confirmed appointments and earlier-visit offers are listed below.'}</p></div>{state&&<button className="secondary" disabled={busy} onClick={()=>void refresh()}>Refresh records</button>}</div>
      <div className="context"><span>{state?<>Signed in as <strong>{state.actor.name}</strong> · {state.actor.role}</>:'Demo sign-in · no password needed'}</span><span>All times: Indianapolis · Eastern Time (EST/EDT)</span></div>
      <div ref={noticeRef} tabIndex={-1} className="update-focus"><Announcements notice={notice} busy={busy}/></div>
      {loading?<p>Loading records…</p>:!state?<section className="card welcome"><h2>Two views. One reliable booking.</h2><p>Sign in as fictional staff to review the schedule, or as a patient to check your appointment and inbox.</p><p>The simulated inbox and scheduling records use fictional data only.</p></section>:<>
        {staff?<>
          <nav aria-label="Clinic views">{[['schedule','Schedule & openings'],['offers','Offers & inbox'],['audit','Audit history']].map(([id,label])=><button className={tab===id?'active':'tab'} aria-pressed={tab===id} onClick={()=>setTab(id)} key={id}>{label}{id==='audit'?` (${state.audit.length})`:''}</button>)}</nav>
          {tab==='schedule'&&<><section><div className="section-title"><h2>Openings to recover</h2><span>{state.openings.length} available</span></div>{state.openings.length?<div className="grid">{state.openings.map(s=><OpeningCard key={s.id} slot={s} run={run} busy={busy}/>)}</div>:<div className="empty">No open slots to recover right now.</div>}</section><StaffAppointments appointments={state.appointments} run={run} busy={busy}/></>}
          {tab==='offers'&&<section><h2>Offers & simulated inbox</h2><p className="muted">These records are the notifications patients see. Nothing is sent by email or SMS.</p>{!state.offers.length&&<div className="empty">No offers sent yet.</div>}<div className="grid">{state.offers.map(o=><article className="card" key={o.id}><div className="row"><h3>{o.patient_name}</h3><Badge status={o.status}/></div><p>Earlier visit: {date(o.starts_at)}</p><p>Reply deadline: {date(o.expires_at,true)}</p><p className="muted">Selection: {o.selection_reason}</p>{o.status==='pending'&&<Revoke offer={o} run={run} busy={busy}/>}</article>)}</div></section>}
          {tab==='audit'&&<section><h2>Audit history</h2><p className="muted">Newest first · timestamps use Indianapolis time</p><div className="card history">{state.audit.map(a=><article key={a.id}><div className="row"><strong>{a.action.replaceAll('.',' · ')}</strong><time>{date(a.at,true)}</time></div><p>{a.actor_name} <span className="muted">· entry {a.id}</span></p><details><summary>Inspect recorded details</summary><pre>{JSON.stringify({entityId:a.entity_id,requestId:a.request_id,...a.details},null,2)}</pre></details></article>)}</div></section>}
        </>:<PatientView appointments={state.appointments} offers={state.offers} uncertain={uncertain} uncertainOfferId={uncertainCommand?.id} retryAcceptance={uncertainCommand?.kind==='accept'} nowMs={nowMs} run={run} busy={busy}/>}
      </>}
      <footer>Earlier · Fictional clinic prototype <span>Exclusive offers. Explicit consent. A recorded history.</span></footer>
    </main>
  </>;
}
