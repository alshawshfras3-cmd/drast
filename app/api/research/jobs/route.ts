import { actor, response } from '@/lib/repository';
import { researchAccess, researchBody } from '@/lib/research-http';
import {supabaseProjectRef} from '@/lib/supabase-storage';
import { researchJobStore, ResearchCloudError } from '@/lib/research-job-store';
export const runtime='nodejs';
export const maxDuration=60;
function failure(error:unknown){if(error instanceof ResearchCloudError)return response({error:error.message,code:error.code,projectRef:supabaseProjectRef()},error.status);if(error instanceof Error&&error.message==='BODY_TOO_LARGE')return response({error:'حجم المهمة أكبر من الحد المسموح.',code:'job_too_large'},413);if(error instanceof SyntaxError||error instanceof Error&&error.message==='EMPTY_BODY')return response({error:'طلب الحفظ غير صالح.',code:'invalid_job'},400);return response({error:'تعذّر الوصول إلى الحفظ السحابي. النسخة المحلية لم تتغير.',code:'cloud_unavailable',projectRef:supabaseProjectRef()},503);}
export async function GET(request:Request){
  const denied=researchAccess(request);if(denied)return denied;const owner=actor(request)!;
  try{const query=new URL(request.url).searchParams;if(query.get('status')==='1'||query.get('action')==='status')return response(await researchJobStore.status(owner));if(query.has('id'))return response(await researchJobStore.read(owner,query.get('id')||''));const raw=query.get('offset')||'0';if(!/^\d{1,4}$/.test(raw))throw new ResearchCloudError('صفحة المهام غير صالحة.',400,'invalid_page');return response(await researchJobStore.list(owner,Number(raw)));}catch(error){return failure(error);}
}
export async function POST(request:Request){
  const denied=researchAccess(request,true);if(denied)return denied;const owner=actor(request)!;
  try{const input=await researchBody(request,2000000) as {job?:unknown;expectedVersion?:unknown};if(!input||!Object.hasOwn(input,'expectedVersion'))throw new ResearchCloudError('يجب تحديد رقم النسخة السابقة أو إنشاء نسخة جديدة.',400,'invalid_version');return response(await researchJobStore.save(owner,input.job,input.expectedVersion));}catch(error){return failure(error);}
}
