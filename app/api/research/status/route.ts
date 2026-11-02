import { response } from '@/lib/repository';
import { researchAccess } from '@/lib/research-http';
import { researchProviderStatus } from '@/lib/research-ai';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const denied = researchAccess(request); if (denied) return denied;
  try { return response(researchProviderStatus()); }
  catch { return response({ error: 'إعداد النموذج غير صالح: يُسمح بالنماذج المجانية فقط.' }, 503); }
}
