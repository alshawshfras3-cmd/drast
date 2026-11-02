import { response } from '@/lib/repository';
import { researchAccess } from '@/lib/research-http';
import { generateResearchText, researchError } from '@/lib/research-ai';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = researchAccess(request, true); if (denied) return denied;
  try {
    const result = await generateResearchText('أجب بكلمة عربية واحدة: جاهز', 256);
    if (!result.text.trim()) throw new Error('MODEL_EMPTY_RESPONSE');
    return response({ ok: true, model: result.model, provider: result.provider, reply: result.text.slice(0, 120), cost: result.cost });
  } catch (error) {
    const safe = researchError(error);
    const tag = String((error as any)?.message || '');
    const code = ['REPORT_TRUNCATED','MODEL_EMPTY_RESPONSE','MODEL_NOT_CONFIGURED','VERCEL_OIDC_MISSING','FREE_MODEL_UNAVAILABLE','FREE_MODEL_PRICE_CHANGED'].includes(tag) ? tag : Number.isInteger((error as any)?.statusCode) ? `upstream_${(error as any).statusCode}` : 'connection_unavailable';
    return response({ ok: false, error: safe.message, code }, safe.status);
  }
}
