import { randomBytes, createHash } from 'node:crypto';
import { cookies,headers } from 'next/headers';
import { pool } from './db';
import { WorkflowError } from './scheduling';
import { requireLocalDemo } from './local-demo';
import {cleanupExpiredSessions} from './request-limits';
import {checkDemoHost,checkDemoOrigin} from './hosting';
export const hashToken = (token:string)=>createHash('sha256').update(token).digest('hex');
export async function currentIdentity() {
  const config=checkDemoHost(await headers());
  const token=(await cookies()).get(config.cookieName)?.value;
  if(!token) throw new WorkflowError('Please sign in.',401);
  const row=(await pool.query('SELECT identity_id FROM sessions WHERE token_hash=$1 AND expires_at>clock_timestamp()',[hashToken(token)])).rows[0];
  if(!row) throw new WorkflowError('Your demo session expired. Please sign in again.',401);
  return row.identity_id as string;
}
export function checkOrigin(request:Request) {
  checkDemoOrigin(request.headers);
}
export async function signIn(id:string) {
  const config=requireLocalDemo();
  const actor=(await pool.query('SELECT id FROM identities WHERE id=$1',[id])).rows[0];
  if(!actor) throw new WorkflowError('Unknown demo identity.',400);
  const jar=await cookies(); const old=jar.get(config.cookieName)?.value;
  await cleanupExpiredSessions();
  if(old) await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hashToken(old)]);
  const token=randomBytes(32).toString('hex');
  await pool.query("INSERT INTO sessions VALUES ($1,$2,clock_timestamp()+interval '8 hours')",[hashToken(token),id]);
  jar.set(config.cookieName,token,{httpOnly:true,sameSite:'strict',secure:config.secure,path:'/',maxAge:28800});
}
export function errorResponse(error:unknown) {
  if(error instanceof WorkflowError) return Response.json({error:error.message},{status:error.status,headers:error.status===429?{'Retry-After':'60'}:undefined});
  console.error('Scheduling request failed.',{code:typeof (error as {code?:unknown})?.code==='string'&&/^[A-Z0-9]{5}$/.test((error as {code:string}).code)?(error as {code:string}).code:'UNEXPECTED'});
  return Response.json({error:'The change could not be confirmed. Refresh to check the recorded result before trying again.'},{status:500});
}
