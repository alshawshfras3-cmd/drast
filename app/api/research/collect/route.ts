import {getResearchIssuer, libraryEvidence} from '@/lib/research-issuers.mjs';
import {getPilotCompany} from '@/lib/pilot-catalog.mjs';
import { actor, listDocuments, readDocument, response, saveDocument } from '@/lib/repository';
import { researchAccess, researchBody } from '@/lib/research-http';
import { collectCompanySources } from '@/lib/source-collector.mjs';
import { collectedPdfRecord } from '@/lib/finance/collected-pdf.mjs';
import { storage, storageReady } from '@/lib/supabase-storage';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = researchAccess(request, true); if (denied) return denied;
  try {
    const { companyId } = await researchBody(request, 4096);
    if (typeof companyId !== 'string') return response({ error: 'اختر شركة من قائمة المتابعة.' }, 400);
    const owner = actor(request);
    if (!owner) return response({error:'هذه مساحة عمل خاصة.'}, 401);
    if (!getPilotCompany(companyId)) {
      const issuer = getResearchIssuer(companyId);
      if (!issuer) return response({error:'الشركة غير موجودة في الفهرس.'},400);
      const documents = storageReady() ? await listDocuments(owner) : [];
      const candidates = documents.filter(doc=>doc.ticker===issuer.ticker && doc.mime==='application/pdf' && doc.extractionStatus==='text_ready').slice(0,3);
      const evidence = (await Promise.all(candidates.map(async doc=>libraryEvidence(issuer,await readDocument(owner,doc.id))))).filter(Boolean);
      return response({evidence,issues:[evidence.length ? 'جُمعت مستندات الشركة من مكتبة المصادر الخاصة. لا يوجد موصل خارجي لهذه الشركة بعد.' : 'ارفع إفصاح PDF نصيًا لهذه الشركة في مكتبة المصادر ثم أعد تشغيل المهمة.']});
    }
    const approved = new Set((process.env.DRAST_ARCHIVE_APPROVED_ISSUERS ?? '').split(',').map(id=>id.trim()).filter(Boolean));
    return response(await collectCompanySources(companyId, {
      ...(storageReady() && approved.has(companyId) ? {
        importPdf: async (company: {id:string;ticker:string;name:string}, source: {url:string;kind:string;totalPages:number;text:string}, bytes: Uint8Array, deadline: number) => {
          const record = collectedPdfRecord(company, source, bytes, approved);
          if (!record) return false;
          const signal = AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
          if (!await readDocument(owner, record.id, signal)) {
            await storage.archivePdf(record.pathname, bytes, signal);
            await saveDocument(owner, record, signal);
          }
          return true;
        },
      } : {}),
    }));
  } catch (error) {
    return response({ error: (error as Error).message === 'BODY_TOO_LARGE' ? 'الطلب كبير جدًا.' : 'تعذر جمع المصادر. تحقق من الشركة وأعد المحاولة.' }, (error as Error).message === 'BODY_TOO_LARGE' ? 413 : 400);
  }
}

