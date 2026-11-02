import { actor,response,listStudies,listDocuments } from '@/lib/repository';
import { storageReady, STORAGE_MESSAGE } from '@/lib/blob-storage';
import { seedStudies } from '@/lib/seeds';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const user=actor(request);
 if(!user)return response({error:'افتح المساحة من رابط Vercel المحمي بحسابك.'},401);
 if(!storageReady())return response({studies:seedStudies,documents:[],storageReady:false,warning:STORAGE_MESSAGE});
 try{const [studies,documents]=await Promise.all([listStudies(user),listDocuments(user)]);return response({studies,documents,storageReady:true})}
 catch(e){console.error('workspace_load_failed',e instanceof Error?e.name:'Error');return response({error:'تعذّر تحميل مساحة العمل. تحقق من ربط التخزين الخاص وأعد المحاولة.'},503)}
}
