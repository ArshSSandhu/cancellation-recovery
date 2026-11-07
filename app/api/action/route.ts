import {limitPublicRequest} from '../../../lib/request-limits';
import {checkOrigin,currentIdentity,errorResponse} from '../../../lib/auth';
import {execute,WorkflowError,type Command} from '../../../lib/scheduling';
export const runtime='nodejs';
export async function POST(request:Request) {
  try {
    checkOrigin(request); await limitPublicRequest('action'); const actor=await currentIdentity(); const body=await request.json();
    if(!body || typeof body!=='object' || !['cancel','send','accept','decline','revoke'].includes(body.kind) || typeof body.id!=='string') throw new WorkflowError('Invalid action.',400);
    if(body.kind!=='send' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) throw new WorkflowError('Invalid record identifier.',400);
    if(body.reason!==undefined && (typeof body.reason!=='string' || body.reason.length>1000)) throw new WorkflowError('Reason must be at most 1,000 characters.',400);
    if(body.waitlistId!==undefined && typeof body.waitlistId!=='string') throw new WorkflowError('Invalid waitlist identifier.',400);
    return Response.json(await execute(actor,body as Command));
  } catch(error){return errorResponse(error);}
}
