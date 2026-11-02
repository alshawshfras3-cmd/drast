import { actor, originAllowed, response } from '@/lib/repository';
import { storageReady, STORAGE_MESSAGE, createSignedDocumentUpload, readBoundedRequestText, SupabaseStorageError } from '@/lib/supabase-storage';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!actor(request)) return response({ error: 'يلزم الدخول إلى المساحة المحمية.' },401);
  if (!originAllowed(request)) return response({ error: 'مصدر الطلب غير مسموح.' },403);
  if (!storageReady()) return response({ error: STORAGE_MESSAGE },503);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return response({error:'صيغة طلب الرفع غير مسموحة.'},415);
  try {
    const input = JSON.parse(await readBoundedRequestText(request,4096));
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.pathname !== 'string') return response({error:'بيانات إذن الرفع غير صالحة.'},400);
    return response(await createSignedDocumentUpload(input.pathname,input.contentType,input.size));
  } catch(error) {
    const status = error instanceof SupabaseStorageError ? error.status : 400;
    return response({error:error instanceof SupabaseStorageError ? error.message : 'تعذّر إصدار إذن الرفع. تحقق من مسار الملف وحجمه.'},status);
  }
}
