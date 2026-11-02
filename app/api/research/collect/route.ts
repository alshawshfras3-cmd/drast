import { response } from '@/lib/repository';
import { researchAccess, researchBody } from '@/lib/research-http';
import { collectCompanySources } from '@/lib/source-collector.mjs';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = researchAccess(request, true); if (denied) return denied;
  try {
    const { companyId } = await researchBody(request, 4096);
    if (typeof companyId !== 'string') return response({ error: 'اختر شركة من قائمة المتابعة.' }, 400);
    return response(await collectCompanySources(companyId));
  } catch (error) {
    return response({ error: (error as Error).message === 'BODY_TOO_LARGE' ? 'الطلب كبير جدًا.' : 'تعذر جمع المصادر. تحقق من الشركة وأعد المحاولة.' }, (error as Error).message === 'BODY_TOO_LARGE' ? 413 : 400);
  }
}
