import 'server-only';
import { validateUploadPath, MAX_FILE_BYTES } from './access-policy.mjs';

const OWNER = 'private-workspace';
export const DOCUMENT_BUCKET = 'drast-documents';
export const STORAGE_MESSAGE = 'الحفظ السحابي غير مهيأ بعد. أضف SUPABASE_URL وSUPABASE_SECRET_KEY في مشروع دراسات المستقل، ثم نفّذ ملف supabase/setup.sql وأعد النشر.';
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_LIST_ITEMS = 1000;

type SupabaseConfig = { url: string; key: string; legacy: boolean };
function configuration(): SupabaseConfig | null {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const modern = process.env.SUPABASE_SECRET_KEY?.trim();
  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const key = modern || legacy;
  if (!rawUrl || !key || /\s/.test(key)) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
    const isOpaqueSecret = key.startsWith('sb_secret_');
    if (!isOpaqueSecret) {
      if (!/^eyJ[^.]+\.[^.]+\.[^.]+$/.test(key)) return null;
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
      if (payload?.role !== 'service_role') return null;
    }
    return { url: url.origin, key, legacy: !isOpaqueSecret };
  } catch { return null; }
}

/** Configuration only. A successful database call is still needed to verify readiness. */
export const storageReady = () => configuration() !== null;
/** Safe troubleshooting only; no key, token fragments or raw environment values. */
export function storageConfigurationMessage(): string {
  if (configuration()) return '';
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!rawUrl || !key) return 'إعدادات Supabase غير مكتملة في بيئة النشر الحالية؛ يلزم رابط المشروع ومفتاح الخادم.';
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) return 'صيغة رابط Supabase غير صالحة؛ استخدم رابط المشروع الأساسي HTTPS دون مسار إضافي أو بيانات دخول.';
  } catch { return 'صيغة رابط Supabase غير صالحة؛ انسخ رابط المشروع الأساسي من إعدادات المشروع.'; }
  if (/\s/.test(key)) return 'مفتاح Supabase يحتوي مسافات أو أسطرًا إضافية. أعد نسخه كاملًا في متغير الخادم ثم أعد النشر.';
  if (key.startsWith('sb_publishable_')) return 'المفتاح المضاف عام من نوع publishable؛ هذا الربط يحتاج مفتاح الخادم السري sb_secret أو service_role، ولا يكفي المفتاح العام.';
  try { if (JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'))?.role === 'anon') return 'المفتاح المضاف من نوع anon العام؛ يلزم مفتاح الخادم service_role أو sb_secret في المتغير السري.'; } catch {}
  return 'الرابط موجود، لكن صيغة مفتاح الخادم لم تُقبل. انسخ قيمة sb_secret أو service_role كاملةً في SUPABASE_SECRET_KEY ثم أعد النشر.';
}
export function supabaseProjectRef(): string | null {
  try {
    const url = new URL(process.env.SUPABASE_URL?.trim() || '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.hostname.split('.')[0] : null;
  } catch { return null; }
}

export class SupabaseStorageError extends Error {
  status: number;
  constructor(message: string, status = 503) { super(message); this.name = 'SupabaseStorageError'; this.status = status; }
}

/** Server-owned REST helper. Never pass request headers or a caller-provided URL. */
export async function supabaseFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = configuration();
  if (!config) throw new SupabaseStorageError(STORAGE_MESSAGE);
  if (!/^\/(rest|storage)\/v1\//.test(path) || /[\r\n\\]/.test(path)) throw new SupabaseStorageError('مسار خدمة غير مسموح.', 400);
  const url = new URL(path, config.url);
  if (url.origin !== config.url || !/^\/(rest|storage)\/v1\//.test(url.pathname)) throw new SupabaseStorageError('وجهة خدمة غير مسموحة.', 400);
  const headers = new Headers(init.headers);
  headers.set('apikey', config.key);
  // New sb_secret keys are opaque, not JWTs. Only legacy service-role keys use Bearer.
  headers.delete('authorization');
  if (config.legacy) headers.set('authorization', `Bearer ${config.key}`);
  const timeout = AbortSignal.timeout(20_000);
  try {
    return await fetch(url, { ...init, headers, cache: 'no-store', redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  } catch {
    throw new SupabaseStorageError('تعذّر الاتصال بالتخزين السحابي. أعد المحاولة بعد التحقق من إعدادات المشروع.');
  }
}

function requireSuccess(result: Response, action: string) {
  if (!result.ok) throw new SupabaseStorageError(`تعذّر ${action}. تحقق من إعداد Supabase وصلاحيات الخدمة.`, result.status === 404 ? 404 : 503);
}
function recordPath(pathname: string) {
  if (typeof pathname !== 'string' || !/^drast\/private-workspace\/records\/(studies|documents)\/[-a-zA-Z0-9_]{1,80}\.json$/.test(pathname)) throw new SupabaseStorageError('مسار سجل غير مسموح.', 400);
  return pathname;
}
function recordsPrefix(prefix: string) {
  if (!['drast/private-workspace/records/studies/', 'drast/private-workspace/records/documents/'].includes(prefix)) throw new SupabaseStorageError('نطاق سجلات غير مسموح.', 400);
  return prefix;
}
const query = (values: Record<string, string>) => new URLSearchParams(values).toString();
function objectPath(pathname: string) {
  validateUploadPath(pathname);
  return `${DOCUMENT_BUCKET}/${pathname.split('/').map(encodeURIComponent).join('/')}`;
}

export function uploadContentType(pathname: string, supplied: unknown) {
  const { extension } = validateUploadPath(pathname);
  if (supplied !== undefined && typeof supplied !== 'string') throw new SupabaseStorageError('نوع الملف غير صالح.', 400);
  const provided = typeof supplied === 'string' ? supplied.split(';')[0].trim().toLowerCase() : '';
  const types: Record<string, { canonical: string; accepted: string[] }> = {
    pdf: {canonical:'application/pdf', accepted:['application/pdf']},
    txt: {canonical:'text/plain', accepted:['text/plain']},
    csv: {canonical:'text/csv', accepted:['text/csv','text/plain','application/vnd.ms-excel']},
    json: {canonical:'application/json', accepted:['application/json','text/plain']},
  };
  const allowed = types[extension];
  if (!allowed || (provided && provided !== 'application/octet-stream' && !allowed.accepted.includes(provided))) throw new SupabaseStorageError('نوع الملف لا يطابق الامتداد المسموح.', 400);
  return allowed.canonical;
}

/** A path-scoped upload grant only; no project key or public read URL leaves the server. */
export async function createSignedDocumentUpload(pathname: string, suppliedType: unknown, size: unknown) {
  const key = objectPath(pathname);
  const contentType = uploadContentType(pathname, suppliedType);
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > MAX_FILE_BYTES) throw new SupabaseStorageError('ارفع ملفًا صالحًا حتى 15 ميجابايت.', 400);
  const endpoint = `/storage/v1/object/upload/sign/${key}`;
  const result = await supabaseFetch(endpoint, {method:'POST', headers:{'Content-Type':'application/json','x-upsert':'false'}, body:'{}'});
  requireSuccess(result, 'إصدار إذن الرفع');
  const body: any = await result.json();
  if (!body || typeof body.url !== 'string') throw new SupabaseStorageError('استجابة إذن الرفع غير صالحة.');
  const config = configuration()!;
  const raw = body.url.startsWith('/object/') ? '/storage/v1' + body.url : body.url;
  let signed: URL;
  try { signed = new URL(raw, config.url); } catch { throw new SupabaseStorageError('رابط إذن الرفع غير صالح.'); }
  const token = signed.searchParams.get('token');
  if (signed.protocol !== 'https:' || signed.origin !== config.url || signed.pathname !== endpoint || signed.username || signed.password || signed.hash || !token || token.length > 12000) throw new SupabaseStorageError('رابط إذن الرفع خارج النطاق المسموح.');
  const uploadUrl = new URL(endpoint, config.url);
  uploadUrl.searchParams.set('token', token);
  return { pathname, uploadUrl:uploadUrl.toString(), method:'PUT' as const,
    headers:{'Content-Type':contentType, 'x-upsert':'false', 'Cache-Control':'max-age=0'},
    maxFileBytes:MAX_FILE_BYTES, expiresIn:7200 };
}

export async function verifyStorageConnection() {
  const [records, bucket] = await Promise.all([
    supabaseFetch('/rest/v1/drast_records?select=pathname&limit=1'),
    supabaseFetch('/storage/v1/bucket/' + DOCUMENT_BUCKET),
  ]);
  requireSuccess(records, 'الاتصال بجدول السجلات');
  requireSuccess(bucket, 'الاتصال بحاوية المستندات');
  const info: any = await bucket.json();
  if (info?.id !== DOCUMENT_BUCKET || info?.public !== false || Number(info?.file_size_limit) !== MAX_FILE_BYTES) throw new SupabaseStorageError('إعداد حاوية المستندات لا يطابق الإعداد الخاص المطلوب. أعد تنفيذ setup.sql.');
  return {recordsReady:true,bucketReady:true};
}

export const storage = {
  async read(pathname: string) {
    recordPath(pathname);
    const result = await supabaseFetch('/rest/v1/drast_records?' + query({owner:`eq.${OWNER}`,pathname:`eq.${pathname}`,select:'payload',limit:'1'}));
    requireSuccess(result, 'قراءة السجل');
    const rows = await result.json();
    if (!Array.isArray(rows)) throw new SupabaseStorageError('استجابة قراءة السجل غير صالحة.');
    return rows[0]?.payload ?? null;
  },
  async write(pathname: string, value: unknown) {
    recordPath(pathname);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SupabaseStorageError('السجل يجب أن يكون كائن بيانات.', 400);
    const body = JSON.stringify({owner:OWNER,pathname,payload:value,updated_at:new Date().toISOString()});
    if (new TextEncoder().encode(body).byteLength > MAX_RECORD_BYTES) throw new SupabaseStorageError('حجم السجل يتجاوز الحد المسموح.', 413);
    const result = await supabaseFetch('/rest/v1/drast_records?on_conflict=owner,pathname', {method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body});
    requireSuccess(result, 'حفظ السجل');
  },
  async list(prefix: string) {
    recordsPrefix(prefix);
    const result = await supabaseFetch('/rest/v1/drast_records?' + query({owner:`eq.${OWNER}`,pathname:`like.${prefix}*`,select:'pathname',order:'pathname.asc',limit:String(MAX_LIST_ITEMS+1)}));
    requireSuccess(result, 'عرض السجلات');
    const rows = await result.json();
    if (!Array.isArray(rows)) throw new SupabaseStorageError('استجابة عرض السجلات غير صالحة.');
    if (rows.length > MAX_LIST_ITEMS) throw new SupabaseStorageError('تجاوزت المساحة حد العرض الحالي؛ يلزم تفعيل التصفح المتدرج.');
    return rows.map((row: {pathname: string}) => recordPath(row.pathname));
  },
  async head(pathname: string) {
    const result = await supabaseFetch('/storage/v1/object/info/' + objectPath(pathname));
    requireSuccess(result, 'قراءة بيانات الملف');
    const body: any = await result.json();
    const rawSize = body?.size ?? body?.metadata?.size;
    const size = typeof rawSize === 'number' ? rawSize : typeof rawSize === 'string' && /^\d+$/.test(rawSize) ? Number(rawSize) : NaN;
    const contentType = body?.content_type ?? body?.contentType ?? body?.metadata?.mimetype;
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES || typeof contentType !== 'string') throw new SupabaseStorageError('بيانات الملف المخزن غير صالحة.', 400);
    uploadContentType(pathname, contentType);
    return {pathname,size,contentType};
  },
  async file(pathname: string) {
    const result = await supabaseFetch('/storage/v1/object/' + objectPath(pathname));
    if (result.status === 404) return null;
    requireSuccess(result, 'تنزيل الملف');
    const contentLength = Number(result.headers.get('content-length'));
    if (contentLength > MAX_FILE_BYTES) {await result.body?.cancel(); throw new SupabaseStorageError('الملف يتجاوز الحد المسموح.', 413);}
    return {statusCode:result.status,stream:result.body,pathname};
  },
};

export async function readBoundedRequestText(request: Request, maximumBytes: number): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) throw new SupabaseStorageError('حجم الطلب يتجاوز الحد المسموح.', 413);
  if (!request.body) return '';
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, output = '';
  try {
    for (;;) {
      const {value,done} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {await reader.cancel(); throw new SupabaseStorageError('حجم الطلب يتجاوز الحد المسموح.', 413);}
      output += decoder.decode(value, {stream:true});
    }
    return output + decoder.decode();
  } finally {reader.releaseLock();}
}
