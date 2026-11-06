import {WorkflowError} from './scheduling';
// A build can be inspected locally in production mode. Hosting the passwordless
// identity switcher requires a separate, explicit deployment/authentication decision.
export function requireLocalDemo() {
  if(process.env.VERCEL)throw new WorkflowError('This passwordless fictional demo is disabled on Vercel. Hosted access has not been configured.',403);
}
