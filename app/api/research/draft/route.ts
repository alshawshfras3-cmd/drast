import { response } from '@/lib/repository';
import { researchAccess, researchBody } from '@/lib/research-http';
import { normalizeResearchRequest, validateEvidence } from '@/lib/research-contract.mjs';
import { draftResearch, researchError } from '@/lib/research-ai';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = researchAccess(request, true); if (denied) return denied;
  let input;
  try {
    const raw = await researchBody(request, 900_000);
    const normalized = normalizeResearchRequest(raw);
    input = { ...normalized, evidence: validateEvidence(raw.evidence, normalized.companyIds), issues: Array.isArray(raw.issues) ? raw.issues.filter((s: unknown) => typeof s === 'string').slice(0, 24).map((s: string) => s.slice(0, 600)) : [] };
  } catch (error) {
    return response({ error: (error as Error).message === 'BODY_TOO_LARGE' ? 'الطلب كبير جدًا.' : 'لا توجد أدلة صالحة كافية لهذا النطاق، أو أن بيانات المهمة غير مكتملة.' }, (error as Error).message === 'BODY_TOO_LARGE' ? 413 : 400);
  }
  try { return response(await draftResearch(input)); }
  catch (error) { const safe = researchError(error); return response({ error: safe.message }, safe.status); }
}
