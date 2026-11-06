import { checkOrigin, errorResponse, signIn } from '../../../lib/auth';
export const runtime='nodejs';
export async function POST(request:Request) {
  try { checkOrigin(request); const body=await request.json(); await signIn(String(body.identityId??'')); return Response.json({ok:true}); }
  catch(error) {return errorResponse(error);}
}
