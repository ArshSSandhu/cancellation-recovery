import './env';
import type {PoolConfig} from 'pg';
import {WorkflowError} from './errors';

type Env=Record<string,string|undefined>;
const requireConfig=(condition:unknown,message:string)=>{if(!condition)throw new WorkflowError(message,503);};
export function demoConfig(env:Env=process.env) {
  if(!env.VERCEL) {
    requireConfig(!env.DEMO_MODE||env.DEMO_MODE==='local','Hosted demo mode requires Vercel.');
    return {hosted:false,origin:null,instance:'local',cookieName:'recovery_session',secure:false} as const;
  }
  requireConfig(env.DEMO_MODE==='protected-fictional','This passwordless fictional demo is disabled on Vercel. Hosted access has not been configured.');
  // This records an operator-verified platform policy. It is NOT itself a gate:
  // Vercel Authentication / All Deployments must actually be enabled and checked
  // with an unauthenticated request BEFORE this configuration is activated.
  requireConfig(env.REVIEWER_ACCESS==='vercel-auth-all-deployments','Reviewer access is not configured.');
  const value=env.APP_ORIGIN??'';let origin:URL;
  try{origin=new URL(value);}catch{throw new WorkflowError('The hosted application origin is not configured.',503);}
  requireConfig(origin.protocol==='https:'&&origin.origin===value&&!origin.username&&!origin.password&&!origin.port,'The hosted application origin must be one exact HTTPS origin.');
  requireConfig(/^[a-z0-9][a-z0-9-]{0,63}$/.test(env.REVIEWER_INSTANCE_ID??''),'The isolated reviewer instance is not configured.');
  return {hosted:true,origin:value,instance:env.REVIEWER_INSTANCE_ID!,cookieName:'__Host-recovery_session',secure:true} as const;
}
export function checkDemoHost(headers:Headers,env:Env=process.env) {
  const config=demoConfig(env);const host=headers.get('host')?.toLowerCase()??'';
  if(config.hosted) {
    if(host!==new URL(config.origin!).host)throw new WorkflowError('Use the assigned reviewer URL.',403);
  }else if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))throw new WorkflowError('This fictional-data demo is local only.',403);
  return config;
}
export function checkDemoOrigin(headers:Headers,env:Env=process.env) {
  const config=checkDemoHost(headers,env);
  const expected=config.hosted?config.origin:`http://${headers.get('host')}`;
  if(headers.get('origin')!==expected)throw new WorkflowError('Request origin was not allowed.',403);
}
export function runtimeDatabaseConfig(env:Env=process.env):PoolConfig {
  if(!env.VERCEL)return {connectionString:env.DATABASE_URL??'postgres://recovery_app:local-demo-app@127.0.0.1:55432/recovery',max:8};
  const value=env.DATABASE_URL;requireConfig(value,'The hosted database is not configured.');
  let url:URL;try{url=new URL(value!);}catch{throw new WorkflowError('The hosted database configuration is invalid.',503);}
  requireConfig(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname.endsWith('.neon.tech')&&url.hostname.includes('-pooler.')&&url.pathname==='/recovery_demo'&&decodeURIComponent(url.username)==='recovery_app'&&!!url.password,'Use the isolated Neon pooled application-role database.');
  requireConfig([...url.searchParams.keys()].every(key=>['sslmode','channel_binding','application_name'].includes(key)),'Unexpected hosted connection settings.');
  requireConfig(!url.searchParams.has('sslmode')||['require','verify-full'].includes(url.searchParams.get('sslmode')!),'TLS is required for the hosted database.');
  // pg connection-string SSL options override the explicit SSL object. Remove
  // the URL option so certificate/hostname verification cannot be downgraded.
  url.searchParams.delete('sslmode');
  return {connectionString:url.toString(),ssl:{rejectUnauthorized:true},max:3,idleTimeoutMillis:5000,connectionTimeoutMillis:8000,allowExitOnIdle:true};
}
