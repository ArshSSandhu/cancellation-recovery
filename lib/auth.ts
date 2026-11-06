import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { pool } from './db';
import { WorkflowError } from './scheduling';
import { requireLocalDemo } from './local-demo';
export const hashToken = (token:string)=>createHash('sha256').update(token).digest('hex');
export async function currentIdentity() {
  requireLocalDemo();
  const token=(await cookies()).get('recovery_session')?.value;
  if(!token) throw new WorkflowError('Please sign in.',401);
  const row=(await pool.query('SELECT identity_id FROM sessions WHERE token_hash=$1 AND expires_at>clock_timestamp()',[hashToken(token)])).rows[0];
  if(!row) throw new WorkflowError('Your demo session expired. Please sign in again.',401);
  return row.identity_id as string;
}
export function checkOrigin(request:Request) {
  requireLocalDemo();
  // Next's internal request URL may normalize 127.0.0.1 to localhost.
  // Compare against the actual Host header, restricted to loopback hosts.
  const host=request.headers.get('host')??'';
  if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw new WorkflowError('This fictional-data demo is local only.',403);
  if(request.headers.get('origin')!==`http://${host}`) throw new WorkflowError('Request origin was not allowed.',403);
}
export async function signIn(id:string) {
  requireLocalDemo();
  const actor=(await pool.query('SELECT id FROM identities WHERE id=$1',[id])).rows[0];
  if(!actor) throw new WorkflowError('Unknown demo identity.',400);
  const jar=await cookies(); const old=jar.get('recovery_session')?.value;
  if(old) await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hashToken(old)]);
  const token=randomBytes(32).toString('hex');
  await pool.query("INSERT INTO sessions VALUES ($1,$2,clock_timestamp()+interval '8 hours')",[hashToken(token),id]);
  jar.set('recovery_session',token,{httpOnly:true,sameSite:'strict',secure:false,path:'/',maxAge:28800});
}
export function errorResponse(error:unknown) {
  if(error instanceof WorkflowError) return Response.json({error:error.message},{status:error.status});
  console.error(error);
  return Response.json({error:'The change could not be confirmed. Refresh to check the recorded result before trying again.'},{status:500});
}
