import {actor,response,originAllowed,saveStudy} from '@/lib/repository';
export const maxDuration = 60;
export async function POST(request:Request){const user=actor(request);if(!user)return response({error:'يلزم تسجيل الدخول.'},401);if(!originAllowed(request))return response({error:'مصدر الطلب غير مسموح.'},403);if(Number(request.headers.get('content-length')||0)>1500000)return response({error:'الطلب كبير جدًا.'},413);try{const raw=await request.text();if(raw.length>700000)return response({error:'الطلب كبير جدًا.'},413);const {study,confirmFinancialFacts}=JSON.parse(raw);return response({study:await saveStudy(user,study,confirmFinancialFacts === true)})}catch(e){return response({error:e instanceof Error?e.message:'فشل حفظ الدراسة.'},400)}}

