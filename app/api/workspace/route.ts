import { actor,response,listStudies,listDocuments } from '@/lib/repository';
import { storageReady, STORAGE_MESSAGE, supabaseProjectRef, verifyStorageConnection } from '@/lib/supabase-storage';
import { seedStudies } from '@/lib/seeds';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const user=actor(request);
 if(!user)return response({error:'افتح المساحة من رابط Vercel المحمي بحسابك.'},401);
 const projectRef=supabaseProjectRef();
 if(!storageReady())return response({studies:seedStudies,documents:[],storageConfigured:false,storageReady:false,storageProvider:'supabase',supabaseProjectRef:projectRef,warning:STORAGE_MESSAGE});
 try{const [studies,documents,health]=await Promise.all([listStudies(user),listDocuments(user),verifyStorageConnection()]);return response({studies,documents,storageConfigured:true,storageReady:true,storageProvider:'supabase',supabaseProjectRef:projectRef,...health})}
 catch(e){console.error('workspace_load_failed',e instanceof Error?e.name:'Error');return response({error:'تعذّر تحميل مساحة العمل. تحقق من متغيرات Supabase وتنفيذ ملف الإعداد ثم أعد المحاولة.',storageConfigured:true,storageReady:false,storageProvider:'supabase',supabaseProjectRef:projectRef},503)}
}
