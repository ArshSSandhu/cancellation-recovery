import type pg from 'pg';
// Insert into an EMPTY schema; this reusable fictional fixture never resets data.
export async function insertFictionalFixtures(c:Pick<pg.Client,'query'>) {
    await c.query(`INSERT INTO identities VALUES ('staff','Alex Morgan','staff'), ('maya','Maya Chen','patient'), ('jordan','Jordan Ellis','patient'), ('sam','Sam Rivera','patient'), ('casey','Casey Park','patient')`);
    await c.query("INSERT INTO clinicians VALUES ('lee','Dr. Avery Lee'), ('patel','Dr. Nisha Patel')");
    // Relative dates keep the demo usable. Dates are rendered explicitly in Indianapolis time.
    await c.query(`INSERT INTO slots (id,clinician_id,starts_at,ends_at,visit_type,modality,location)
      SELECT id,clinician, date_trunc('day', clock_timestamp() AT TIME ZONE 'America/Indiana/Indianapolis') AT TIME ZONE 'America/Indiana/Indianapolis' + offset_day * interval '1 day' + interval '10 hours',
      date_trunc('day', clock_timestamp() AT TIME ZONE 'America/Indiana/Indianapolis') AT TIME ZONE 'America/Indiana/Indianapolis' + offset_day * interval '1 day' + interval '10 hours 30 minutes',
      'follow-up','video','Clinic video portal'
      FROM (VALUES ('opening','lee',3),('maya-old','lee',14),('jordan-old','lee',16),('sam-old','patel',18),('casey-old','lee',20)) AS s(id,clinician,offset_day)`);
    for (const [patient, slot] of [['casey','opening'],['maya','maya-old'],['jordan','jordan-old'],['sam','sam-old'],['casey','casey-old']]) {
      await c.query(`INSERT INTO appointments(patient_id,slot_id,starts_at,ends_at,status) SELECT $1,id,starts_at,ends_at,'booked' FROM slots WHERE id=$2`, [patient,slot]);
    }
    for (const [patient, days, cleared] of [['maya',12,true],['jordan',8,true],['sam',15,true],['casey',6,false]] as const) {
      await c.query(`INSERT INTO waitlist(id,appointment_id,joined_at,cleared,available_from,available_until)
        SELECT $1,a.id,clock_timestamp()-$2*interval '1 day',$3,clock_timestamp(),clock_timestamp()+interval '30 days'
        FROM appointments a WHERE a.slot_id=$4`, [`wait-${patient}`,days,cleared,`${patient}-old`]);
    }
    await c.query(`INSERT INTO audit(actor_id,action,entity_id,request_id,details) VALUES ('staff','demo.seeded','demo',gen_random_uuid(),'{"note":"Fictional identities and appointments; no patient data"}')`);
}
