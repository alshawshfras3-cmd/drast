import { isAllowedCompanySourceUrl } from '@/lib/pilot-catalog.mjs';

/** Browser-only research records. This database is isolated from other projects. */
export type ResearchType = 'results' | 'event' | 'sector';
export type TaskStatus = 'queued' | 'collecting' | 'drafting' | 'paused' | 'ready' | 'sources_only' | 'blocked' | 'failed' | 'no_change';
export type Evidence = {
  id: string; companyId: string; title: string; url: string; text: string;
  checkedAt: string; kind: 'html' | 'pdf'; pagesRead?: number; totalPages?: number; truncated?: boolean;
};
export type ResearchReport = {
  title: string; summary: string;
  sections: { title: string; body: string; kind: 'fact' | 'management' | 'analysis' | 'scenario'; sourceIds: string[] }[];
  limitations: string[]; nextWatch: string[];
};
export type ResearchJob = {
  id: string; companyIds: string[]; question: string; type: ResearchType;
  status: TaskStatus; createdAt: string; updatedAt: string; day: string;
  evidence: Evidence[]; issues: string[]; collectedCompanyIds: string[];
  fingerprint?: string; forceVersion?: boolean; previousId?: string; duplicateOf?: string;
  report?: ResearchReport; mode?: 'ai' | 'sources_only'; model?: string;
  editedText?: string; editedAt?: string; completedAt?: string;
  stage?: string; error?: string;
};
const DATABASE = 'drast-private-research-v1';
const STORE = 'research-jobs';
let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('هذا المتصفح لا يتيح الحفظ المحلي. افتح المنصة في متصفح يدعم IndexedDB.'));
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onerror = () => { opening = undefined; reject(new Error('تعذّر فتح الحفظ المحلي. قد تكون مساحة المتصفح غير متاحة.')); };
    request.onblocked = () => { opening = undefined; reject(new Error('أغلق النسخ القديمة من المنصة، ثم أعد فتح هذه الصفحة.')); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
  });
  return opening;
}
export async function readResearchJobs(): Promise<ResearchJob[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as ResearchJob[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(new Error('تعذّرت قراءة المهام المحفوظة في المتصفح.'));
  });
}
export async function saveResearchJob(job: ResearchJob): Promise<void> {
  return saveResearchJobs([job]);
}
export async function saveResearchJobs(jobs: ResearchJob[]): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    jobs.forEach(job => transaction.objectStore(STORE).put(job));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('لم تُحفظ التغييرات. تحقّق من المساحة المتاحة في المتصفح وصدّر نسخة احتياطية.'));
    transaction.onabort = () => reject(new Error('توقف الحفظ المحلي. لم تُحفظ التغييرات.'));
  });
}
export async function removeResearchJob(id: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('تعذّر حذف المهمة.'));
  });
}
export function parseResearchBackup(value: unknown, allowedCompanies: string[]): ResearchJob[] {
  const data = value as { schemaVersion?: number; jobs?: unknown[]; job?: unknown };
  const records = data && Array.isArray(data.jobs) ? data.jobs : data?.job ? [data.job] : null;
  if (!data || data.schemaVersion !== 1 || !records || records.length > 1000) throw new Error('الملف ليس نسخة احتياطية صالحة من منصة دراسات.');
  const statuses: TaskStatus[] = ['queued', 'collecting', 'drafting', 'paused', 'ready', 'sources_only', 'blocked', 'failed', 'no_change'];
  const types: ResearchType[] = ['results', 'event', 'sector'];
  const restored = records.map(raw => {
    const job = raw as ResearchJob;
    if (!job || typeof job.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(job.id) || !types.includes(job.type) || !statuses.includes(job.status)
      || typeof job.question !== 'string' || job.question.length > 2000 || !job.question.trim()
      || !Array.isArray(job.companyIds) || job.companyIds.length < 1 || job.companyIds.length > 3 || new Set(job.companyIds).size !== job.companyIds.length || job.companyIds.some(id => !allowedCompanies.includes(id))
      || !Number.isFinite(Date.parse(job.createdAt)) || !Number.isFinite(Date.parse(job.updatedAt)) || !/^\d{4}-\d{2}-\d{2}$/.test(job.day)
      || [job.completedAt, job.editedAt].some(value => value !== undefined && (typeof value !== 'string' || !Number.isFinite(Date.parse(value))))
      || [job.stage, job.error, job.model].some(value => value !== undefined && typeof value !== 'string')
      || !Array.isArray(job.evidence) || !Array.isArray(job.issues) || job.issues.length > 24 || !job.issues.every(x => typeof x === 'string' && x.length <= 1000) || !Array.isArray(job.collectedCompanyIds)
      || job.collectedCompanyIds.some(id => !job.companyIds.includes(id))
      || job.evidence.length > 9 || new Set(job.evidence.map(e => e?.id)).size !== job.evidence.length
      || job.evidence.reduce((total, e) => total + (typeof e?.text === 'string' ? e.text.length : 0), 0) > 180000
      || job.evidence.some(e => !e || typeof e.id !== 'string' || typeof e.title !== 'string' || typeof e.text !== 'string' || e.text.length > 30000 || !e.text.trim() || typeof e.url !== 'string' || !isAllowedCompanySourceUrl(e.companyId, e.url) || !['html', 'pdf'].includes(e.kind) || !job.companyIds.includes(e.companyId) || !Number.isFinite(Date.parse(e.checkedAt)))
      || (job.editedText !== undefined && (typeof job.editedText !== 'string' || job.editedText.length > 300000))) throw new Error('تحتوي النسخة على مهمة غير صالحة؛ لم تُستورد أي بيانات.');
    if (job.report && (!['ai', 'sources_only'].includes(job.mode || '') || (job.status === 'ready' && job.mode !== 'ai') || (job.status === 'sources_only' && job.mode !== 'sources_only') || typeof job.report.title !== 'string' || typeof job.report.summary !== 'string' || !Array.isArray(job.report.sections)
      || job.report.sections.some(s => !s || typeof s.title !== 'string' || typeof s.body !== 'string' || !['fact', 'management', 'analysis', 'scenario'].includes(s.kind) || !Array.isArray(s.sourceIds) || !s.sourceIds.every(id => typeof id === 'string' && job.evidence.some(e => e.id === id)))
      || !Array.isArray(job.report.limitations) || !job.report.limitations.every(x => typeof x === 'string') || !Array.isArray(job.report.nextWatch) || !job.report.nextWatch.every(x => typeof x === 'string'))) throw new Error('تحتوي النسخة على تقرير غير صالح؛ لم تُستورد أي بيانات.');
    if (['ready', 'sources_only'].includes(job.status) && !job.report) throw new Error('تحتوي النسخة على مهمة مكتملة دون تقرير صالح.');
    return { ...job, fingerprint: undefined, forceVersion: false, status: ['collecting', 'drafting'].includes(job.status) ? 'paused' as TaskStatus : job.status, collectedCompanyIds: job.collectedCompanyIds.filter(id => job.companyIds.includes(id)) };
  });
  if (new Set(restored.map(job => job.id)).size !== restored.length) throw new Error('تحتوي النسخة على معرّفات مهام مكررة.');
  return restored.map(job => {
    const previous = restored.find(other => other.id === job.duplicateOf && other.id !== job.id && other.report);
    return { ...job, duplicateOf: previous?.id, status: job.status === 'no_change' && !previous ? 'paused' : job.status };
  });
}
