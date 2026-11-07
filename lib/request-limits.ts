import type pg from 'pg';
import {pool} from './db';
import {demoConfig} from './hosting';
import {WorkflowError} from './errors';
export const publicBudgets={signin:20,action:60,state:120} as const;
// Atomic shared fixed windows across all instances, without the scheduling lock.
// Global budgets intentionally trade fairness for a small bounded implementation.
export async function consumePublicBudget(kind:keyof typeof publicBudgets,db:Pick<pg.Pool,'query'>=pool) {
  const result=await db.query(`INSERT INTO request_limits(kind,used) VALUES($1,1)
    ON CONFLICT(kind) DO UPDATE SET
      used=CASE WHEN request_limits.started_at<=clock_timestamp()-interval '60 seconds' THEN 1 ELSE request_limits.used+1 END,
      started_at=CASE WHEN request_limits.started_at<=clock_timestamp()-interval '60 seconds' THEN clock_timestamp() ELSE request_limits.started_at END
    WHERE request_limits.started_at<=clock_timestamp()-interval '60 seconds' OR request_limits.used<$2 RETURNING used`,[kind,publicBudgets[kind]]);
  if(!result.rowCount)throw new WorkflowError('This shared demo is busy. Wait one minute, then refresh records before retrying. This request did not change a booking.',429);
}
export async function limitPublicRequest(kind:keyof typeof publicBudgets) {
  demoConfig(); // Fail closed even before a session exists.
  if(process.env.VERCEL&&process.env.DEMO_MODE==='public-fictional')await consumePublicBudget(kind);
}

export async function cleanupExpiredSessions(db:Pick<pg.Pool,'query'>=pool) {
  await db.query('DELETE FROM sessions WHERE expires_at<=clock_timestamp()');
}
