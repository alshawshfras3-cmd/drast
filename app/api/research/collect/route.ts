import {getResearchConnector, getResearchIssuer, libraryEvidence} from '@/lib/research-issuers.mjs';
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
    if (typeof companyId !== 'string') return response({ error: 'اختر شركة من الفهرس.' }, 400);
    const owner = actor(request);
    if (!owner) return response({error:'هذه مساحة عمل خاصة.'}, 401);
    const connector = getResearchConnector(companyId);
    if (!connector) {
      const issuer = getResearchIssuer(companyId);
      if (!issuer) return response({error:'الشركة غير موجودة في الفهرس.'},400);
      if (!storageReady()) return response({error:'مكتبة الإفصاحات غير مهيّأة في هذه البيئة. يلزم ربط تخزين «دراسات» قبل البحث في مستندات الشركة.'},503);
      const reports = (await listDocuments(owner)).filter(doc=>doc.ticker===issuer.ticker && doc.mime==='application/pdf');
      const candidates = reports.filter(doc=>doc.extractionStatus==='text_ready').slice(0,3);
      const evidence = (await Promise.all(candidates.map(async doc=>libraryEvidence(issuer,await readDocument(owner,doc.id))))).filter(Boolean);
      const summary = evidence.length
        ? 'جُمعت الإفصاحات من مكتبة المصادر الخاصة.'
        : reports.length
          ? 'يوجد PDF باسم هذه الشركة، لكن نصه غير قابل للاستخدام. راجع الملف أو ارفع نسخة نصية.'
          : 'لا يوجد إفصاح PDF محفوظ لهذه الشركة، والجلب الخارجي غير مهيّأ لها بعد.';
      return response({evidence,issues:[summary],summary});
    }
    const approved = new Set((process.env.DRAST_ARCHIVE_APPROVED_ISSUERS ?? '').split(',').map(id=>id.trim()).filter(Boolean));
    const result = await collectCompanySources(connector.id, {
      ...(storageReady() && approved.has(connector.id) ? {
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
    });
    return response({
      ...result, companyId,
      evidence:result.evidence.map(item=>({...item,companyId})),
      ...(!result.evidence.length ? {summary:'لم ينجح الجلب في توفير نص قابل للدراسة. راجع تفاصيل المصادر لمعرفة السبب.'} : {}),
    });
  } catch (error) {
    return response({ error: (error as Error).message === 'BODY_TOO_LARGE' ? 'الطلب كبير جدًا.' : 'تعذر جمع المصادر. تحقق من الشركة وأعد المحاولة.' }, (error as Error).message === 'BODY_TOO_LARGE' ? 413 : error instanceof SyntaxError ? 400 : 503);
  }
}

