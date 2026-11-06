import { currentIdentity,errorResponse } from '../../../lib/auth';
import {getState} from '../../../lib/scheduling';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET() {
  try{return Response.json(await getState(await currentIdentity()),{headers:{'Cache-Control':'no-store'}});}
  catch(error){return errorResponse(error);}
}
