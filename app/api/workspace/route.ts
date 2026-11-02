import { actor,response,listStudies,listDocuments } from '@/lib/repository';
export const dynamic='force-dynamic';
export async function GET(request:Request){const user=actor(request);if(!user)return response({error:'سجّل الدخول لفتح مساحة الدراسات.'},401);try{const [studies,documents]=await Promise.all([listStudies(user),listDocuments(user)]);return response({studies,documents})}catch{return response({error:'تعذّر تحميل مساحة العمل. أعد المحاولة.'},503)}}
