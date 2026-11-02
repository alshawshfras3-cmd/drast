import { response } from '@/lib/repository';
import { researchAccess } from '@/lib/research-http';
import { generateVercelFreeText } from '@/lib/vercel-free-ai';
import { researchError } from '@/lib/research-ai';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = researchAccess(request, true); if (denied) return denied;
  try {
    const result = await generateVercelFreeText('أجب بكلمة عربية واحدة: جاهز', 32);
    return response({ ok: true, model: result.model, provider: result.provider, reply: result.text.slice(0, 120), cost: result.cost });
  } catch (error) { const safe = researchError(error); return response({ ok: false, error: safe.message, code: (error as any)?.type || 'connection_unavailable' }, safe.status); }
}
