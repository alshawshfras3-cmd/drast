import { actor, response, originAllowed, readDocument, readFile, saveDocument } from '@/lib/repository';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const owner = actor(request);
  if (!owner) return response({ error: 'يلزم الدخول إلى المساحة المحمية.' }, 401);
  const url = new URL(request.url), id = url.searchParams.get('id');
  if (!id) return response({ error: 'حدد المستند.' }, 400);
  try {
    if (url.searchParams.get('download') === 'true') {
      const result = await readFile(owner, id);
      if (!result?.file || result.file.statusCode !== 200) return response({ error: 'الملف غير موجود.' }, 404);
      return new Response(result.file.stream, { headers: {
        'Content-Type': result.doc.mime || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.doc.name)}`,
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      } });
    }
    const doc = await readDocument(owner,id);
    return doc ? response(doc) : response({ error: 'المستند غير موجود.' },404);
  } catch { console.error('document_read_failed'); return response({ error: 'تعذّرت قراءة التقرير.' },503); }
}
export async function POST(request: Request) {
  const owner = actor(request);
  if (!owner) return response({ error: 'يلزم الدخول إلى المساحة المحمية.' },401);
  if (!originAllowed(request)) return response({ error: 'مصدر الطلب غير مسموح.' },403);
  if (Number(request.headers.get('content-length') || 0) > 4 * 1024 * 1024) return response({ error: 'بيانات التقرير كبيرة جدًا.' },413);
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 4 * 1024 * 1024) return response({ error: 'بيانات التقرير كبيرة جدًا.' },413);
    return response(await saveDocument(owner, JSON.parse(body)));
  } catch(e) { return response({ error: e instanceof Error ? e.message : 'تعذّر حفظ التقرير.' },400); }
}
