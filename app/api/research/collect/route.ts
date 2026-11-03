import { actor, readDocument, response, saveDocument } from '@/lib/repository';
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

