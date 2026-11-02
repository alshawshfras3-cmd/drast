import { get, head, list, put } from '@vercel/blob';
export const storageReady = () => Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
export const STORAGE_MESSAGE = 'التخزين الخاص غير مربوط بعد. اربط مخزن Vercel Blob من النوع Private بمشروع drast ثم أعد النشر لتفعيل الحفظ ورفع التقارير.';
function requireStorage() { if (!storageReady()) throw Error(STORAGE_MESSAGE); }
export const storage = {
  async read(pathname: string) {
    requireStorage();
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.stream) throw Error('تعذّرت قراءة السجل.');
    return new Response(result.stream).json();
  },
  async write(pathname: string, value: unknown) {
    requireStorage();
    await put(pathname, JSON.stringify(value), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
  },
  async list(prefix: string) {
    requireStorage();
    const result = await list({ prefix, limit: 1000 });
    if (result.hasMore) throw Error('تجاوزت المساحة حد العرض الحالي؛ يلزم تفعيل التصفح المتدرج.');
    return result.blobs.map(blob => blob.pathname);
  },
  async head(pathname: string) { requireStorage(); return head(pathname); },
  async file(pathname: string) { requireStorage(); return get(pathname, { access: 'private', useCache: false }); },
};
