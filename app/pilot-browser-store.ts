import { allowedResearchEvidenceUrl } from '@/lib/research-issuers.mjs';

/** Local research cache. Optional cloud transfers use the private server API. */
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
const SYNC_STORE = 'research-cloud-versions';
export type CloudSyncStamp = { id: string; version: string; localUpdatedAt: string; cloudUpdatedAt: string };
export type CloudJobSummary = { id: string; version: string; updatedAt: string; jobUpdatedAt?: string; question?: string; status?: TaskStatus; companyIds?: string[] };
export type CloudJobsStatus = { configured: boolean; connected: boolean; projectRef?: string|null; message?: string };
let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('هذا المتصفح لا يتيح الحفظ المحلي. افتح المنصة في متصفح يدعم IndexedDB.'));
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => { const db=request.result; if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});if(!db.objectStoreNames.contains(SYNC_STORE))db.createObjectStore(SYNC_STORE,{keyPath:'id'}); };
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
    const transaction = db.transaction([STORE,SYNC_STORE], 'readwrite');
    transaction.objectStore(STORE).delete(id);
    transaction.objectStore(SYNC_STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('تعذّر حذف المهمة.'));
  });
}
export function validateResearchJobPayload(raw: unknown, allowedCompanies: string[]): ResearchJob {
  const statuses: TaskStatus[] = ['queued', 'collecting', 'drafting', 'paused', 'ready', 'sources_only', 'blocked', 'failed', 'no_change'];
  const types: ResearchType[] = ['results', 'event', 'sector'];
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
      || job.evidence.some(e => !e || typeof e.id !== 'string' || typeof e.title !== 'string' || typeof e.text !== 'string' || e.text.length > 30000 || !e.text.trim() || typeof e.url !== 'string' || !allowedResearchEvidenceUrl(e.companyId, e.url) || !['html', 'pdf'].includes(e.kind) || !job.companyIds.includes(e.companyId) || !Number.isFinite(Date.parse(e.checkedAt)))
      || (job.editedText !== undefined && (typeof job.editedText !== 'string' || job.editedText.length > 300000))) throw new Error('تحتوي النسخة على مهمة غير صالحة؛ لم تُستورد أي بيانات.');
    if (job.report && (!['ai', 'sources_only'].includes(job.mode || '') || (job.status === 'ready' && job.mode !== 'ai') || (job.status === 'sources_only' && job.mode !== 'sources_only') || typeof job.report.title !== 'string' || typeof job.report.summary !== 'string' || !Array.isArray(job.report.sections)
      || job.report.sections.some(s => !s || typeof s.title !== 'string' || typeof s.body !== 'string' || !['fact', 'management', 'analysis', 'scenario'].includes(s.kind) || !Array.isArray(s.sourceIds) || !s.sourceIds.every(id => typeof id === 'string' && job.evidence.some(e => e.id === id)))
      || !Array.isArray(job.report.limitations) || !job.report.limitations.every(x => typeof x === 'string') || !Array.isArray(job.report.nextWatch) || !job.report.nextWatch.every(x => typeof x === 'string'))) throw new Error('تحتوي النسخة على تقرير غير صالح؛ لم تُستورد أي بيانات.');
    if (['ready', 'sources_only'].includes(job.status) && !job.report) throw new Error('تحتوي النسخة على مهمة مكتملة دون تقرير صالح.');

  const {cloudSync: _ignoredSync, owner: _ignoredOwner, ...safeJob}=job as ResearchJob & {cloudSync?:unknown;owner?:unknown};
  return safeJob;
}
export function parseResearchBackup(value: unknown, allowedCompanies: string[]): ResearchJob[] {
  const data = value as { schemaVersion?: number; jobs?: unknown[]; job?: unknown };
  const records = data && Array.isArray(data.jobs) ? data.jobs : data?.job ? [data.job] : null;
  if (!data || data.schemaVersion !== 1 || !records || records.length > 1000) throw new Error('الملف ليس نسخة احتياطية صالحة من منصة دراسات.');
  const restored = records.map(raw => {
    const job=validateResearchJobPayload(raw,allowedCompanies);
    return { ...job, fingerprint: undefined, forceVersion: false, status: ['collecting', 'drafting'].includes(job.status) ? 'paused' as TaskStatus : job.status, collectedCompanyIds: job.collectedCompanyIds.filter(id => job.companyIds.includes(id)) };
  });
  if (new Set(restored.map(job => job.id)).size !== restored.length) throw new Error('تحتوي النسخة على معرّفات مهام مكررة.');
  return restored.map(job => {
    const previous = restored.find(other => other.id === job.duplicateOf && other.id !== job.id && other.report);
    return { ...job, duplicateOf: previous?.id, status: job.status === 'no_change' && !previous ? 'paused' : job.status };
  });
}

export async function readCloudSyncStamps(): Promise<CloudSyncStamp[]> {
  const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction(SYNC_STORE,'readonly').objectStore(SYNC_STORE).getAll();request.onsuccess=()=>resolve(request.result as CloudSyncStamp[]);request.onerror=()=>reject(new Error('تعذّرت قراءة حالة الحفظ السحابي المحلية.'));});
}
export async function saveCloudSyncStamp(stamp:CloudSyncStamp):Promise<void>{
  const db=await database();return new Promise((resolve,reject)=>{const transaction=db.transaction(SYNC_STORE,'readwrite');transaction.objectStore(SYNC_STORE).put(stamp);transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(new Error('حُفظت النسخة سحابيًا، لكن تعذّر تسجيل رقم نسختها محليًا.'));transaction.onabort=()=>reject(new Error('تعذّر تسجيل حالة الحفظ السحابي محليًا.'));});
}
async function cloudResponse(response:Response){
  let data:any;try{data=await response.json();}catch{throw new Error('استجابة الحفظ السحابي غير مكتملة.');}
  if(!response.ok){const error=new Error(typeof data.error==='string'?data.error:'تعذّر الاتصال بالحفظ السحابي.') as Error&{code?:string};error.code=data.code;throw error;}return data;
}
export async function checkCloudJobs():Promise<CloudJobsStatus>{return cloudResponse(await fetch('/api/research/jobs?status=1',{cache:'no-store'}));}
export async function listCloudJobs():Promise<CloudJobSummary[]>{
  const records:CloudJobSummary[]=[];let offset=0;for(let page=0;page<50;page++){const data=await cloudResponse(await fetch(`/api/research/jobs?offset=${offset}`,{cache:'no-store'}));if(!Array.isArray(data.jobs))throw new Error('قائمة المهام السحابية غير صالحة.');records.push(...data.jobs);if(data.nextOffset===null||data.nextOffset===undefined)return records;offset=data.nextOffset;}throw new Error('قائمة المهام كبيرة جدًا لهذه النسخة.');
}
export async function fetchCloudJob(id:string):Promise<{job:ResearchJob;version:string;updatedAt:string}>{return cloudResponse(await fetch(`/api/research/jobs?id=${encodeURIComponent(id)}`,{cache:'no-store'}));}
export async function uploadCloudJob(job:ResearchJob,expectedVersion:string|null):Promise<{id:string;version:string;updatedAt:string}>{
 return cloudResponse(await fetch('/api/research/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job,expectedVersion})}));
}

