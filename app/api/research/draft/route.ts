import {getResearchIssuer, libraryEvidence, libraryEvidenceId} from '@/lib/research-issuers.mjs';
import { actor, readDocument, response } from '@/lib/repository';
import { researchAccess, researchBody } from '@/lib/research-http';
import { createSourcesOnlyReport, normalizeResearchRequest, validateEvidence } from '@/lib/research-contract.mjs';
import { draftResearch, researchError } from '@/lib/research-ai';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = researchAccess(request, true); if (denied) return denied;
  let input;
  try {
    const raw = await researchBody(request, 900_000);
    const normalized = normalizeResearchRequest(raw);
    const owner=actor(request);
    if (!owner) return response({error:'هذه مساحة عمل خاصة.'},401);
    const submitted=validateEvidence(raw.evidence, normalized.companyIds);
    const evidence=await Promise.all(submitted.map(async (item: {url:string;companyId:string})=>{
      const id=libraryEvidenceId(item.url);
      return id ? libraryEvidence(getResearchIssuer(item.companyId),await readDocument(owner,id)) : item;
    }));
    input = { ...normalized, evidence: validateEvidence(evidence, normalized.companyIds), issues: Array.isArray(raw.issues) ? raw.issues.filter((s: unknown) => typeof s === 'string').slice(0, 24).map((s: string) => s.slice(0, 600)) : [] };
  } catch (error) {
    return response({ error: (error as Error).message === 'BODY_TOO_LARGE' ? 'الطلب كبير جدًا.' : 'لا توجد أدلة صالحة كافية لهذا النطاق، أو أن بيانات المهمة غير مكتملة.' }, (error as Error).message === 'BODY_TOO_LARGE' ? 413 : 400);
  }
  try {
    if (input.evidence.some((item: {url:string})=>libraryEvidenceId(item.url))) {
      const report=createSourcesOnlyReport(input);
      report.summary='جُمعت إفصاحات الشركة من مكتبة المصادر الخاصة. يمكنك فتح المراجع ومراجعة الأرقام داخل المنصة.';
      report.nextWatch=['افتح مكتبة المصادر لمراجعة الأرقام واعتماد الدراسة المالية.'];
      return response({report,mode:'sources_only',model:null});
    }
    return response(await draftResearch(input));
  }
  catch (error) { const safe = researchError(error); return response({ error: safe.message, ...(safe.diagnostic ? {diagnostic:safe.diagnostic} : {}) }, safe.status); }
}

