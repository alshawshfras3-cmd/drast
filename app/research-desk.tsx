'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Database, ArrowLeft, ArrowUpLeft, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, Clock3, Download, ExternalLink, FilePenLine, FileText, FolderArchive, HardDrive, History, Inbox, Layers3, ListTodo, LoaderCircle, Pause, Play, Plus, Printer, RefreshCw, Save, Search, ShieldCheck, Sparkles, TriangleAlert, Upload, X } from 'lucide-react';
import { getResearchConnector, getResearchIssuer, libraryEvidenceId, researchIssuerIds } from '@/lib/research-issuers.mjs';
import { isSafeSourceUrl } from '@/lib/study-engine.mjs';
import { parseResearchBackup, readResearchJobs, removeResearchJob, saveResearchJob, saveResearchJobs, readCloudSyncStamps, saveCloudSyncStamp, checkCloudJobs, listCloudJobs, fetchCloudJob, uploadCloudJob, type CloudJobsStatus, type CloudJobSummary, type CloudSyncStamp, type Evidence, type ResearchJob, type ResearchReport, type ResearchType, type TaskStatus } from './pilot-browser-store';

export type ResearchCompany = { id: string; name: string; ticker: string; sector: string; entityKind?: 'listed' | 'project' | 'private_company' };
type ProviderStatus = { configured: boolean; provider: string; model: string; freeOnly: boolean; mode: 'ai' | 'sources_only' };
const typeLabels: Record<ResearchType, string> = { results: 'نتائج مالية', event: 'أثر خبر أو حدث', sector: 'مقارنة قطاعية' };
const statusLabels: Record<TaskStatus, string> = { queued: 'في الطابور', collecting: 'يجمع المصادر', drafting: 'يُعد المسودة', paused: 'متوقفة مؤقتًا', ready: 'مسودة للمراجعة', sources_only: 'مصادر مجمّعة', blocked: 'تحتاج مصادر', failed: 'تحتاج متابعة', no_change: 'لا مصادر جديدة' };
const kindLabels = { fact: 'حقيقة من المصدر', management: 'تفسير الإدارة', analysis: 'استنتاج تحليلي', scenario: 'سيناريو محتمل' };
const nf = new Intl.NumberFormat('ar-SA');
const date = (value: string) => new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh', calendar: 'gregory' }).format(new Date(value));
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'تعذّر تنفيذ العملية. حاول مجددًا.'; }
function downloadFile(name: string, body: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function reportText(job: ResearchJob) {
  const report = job.report;
  if (!report) return '';
  return [report.title, job.mode === 'sources_only' ? 'حصر مصادر — لا يمثل دراسة مكتملة' : 'مسودة بحث آلية — تتطلب مراجعة بشرية', '', report.summary,
    ...report.sections.flatMap(section => ['', `${section.title} · ${kindLabels[section.kind]}`, section.body, section.sourceIds.length ? `إسناد: ${section.sourceIds.map(id => `[${id}]`).join('، ')}` : '']),
    '', 'حدود البيانات', ...report.limitations.map(x => `• ${x}`), '', 'ما نتابعه لاحقًا', ...report.nextWatch.map(x => `• ${x}`), '', 'المصادر',
    ...job.evidence.map(e => `[${e.id}] ${e.title}\n${e.url}\nتاريخ الجمع: ${date(e.checkedAt)}`), '', `أُعدت المسودة: ${date(job.completedAt || job.updatedAt)}`].join('\n');
}
async function digestFingerprint(job: ResearchJob, fingerprints: string[]) {
  const stable = JSON.stringify({ draftPolicy: 'source-quotes-v2', companyIds: [...job.companyIds].sort(), question: job.question.trim().replace(/\s+/g, ' '), type: job.type, sources: fingerprints.sort() });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function requestJSON(path: string, body: unknown, signal: AbortSignal) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  let data: any;
  try { data = await response.json(); } catch { throw new Error('أعاد الخادم استجابة غير مكتملة. استأنف المهمة لاحقًا.'); }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'تعذّر الاتصال بخدمة البحث. حاول لاحقًا.');
  return data;
}
const isStrategicCompany = (company?: ResearchCompany) => company?.entityKind === 'project' || company?.entityKind === 'private_company';
const dailyType = (company: ResearchCompany): ResearchType => isStrategicCompany(company) ? 'event' : 'results';
const STRATEGIC_QUESTION = 'راجع أحدث الإفصاحات والمستجدات الرسمية للجهة: نموذج العمل أو المشروع، أبرز المبادرات والتطورات، والأثر الاستراتيجي والمخاطر. افصل الأهداف المعلنة عن النتائج المحققة، ولا تفترض بيانات مالية أو سعر سهم عند غيابها.';
const DEFAULT_QUESTIONS: Record<ResearchType, string> = {
  results: 'راجع أحدث نتائج مالية منشورة، وقارن الفترات المتاحة فعلًا. وضّح نمو الإيرادات والأرباح والتدفقات النقدية، والعوامل التي ذكرتها الإدارة، وما ينقصنا للتحقق من الحالة الحالية.',
  event: 'ادرس أثر الحدث المحدد في السؤال على الجهات المختارة. افصل الأثر الذي أعلنته الجهة عن الاستنتاجات والسيناريوهات، واذكر الأدلة وحدودها.',
  sector: 'قارن الجهات المختارة بحسب طبيعة نشاطها والمقاييس القابلة للمقارنة. وضّح اختلاف نشاط كل جهة وأي اختلاف في الوحدات أو الفترات، ولا تستنتج ترتيبًا عند نقص الأدلة.'
};

export default function ResearchDesk({ companies, renderFinancialCharts, onOpenLibrary }: { companies: ResearchCompany[]; onOpenLibrary?: () => void; renderFinancialCharts?: (companyIds: string[]) => React.ReactNode }) {
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const jobsRef = useRef<ResearchJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [cloudStatus,setCloudStatus]=useState<CloudJobsStatus|null>(null);
  const [cloudStamps,setCloudStamps]=useState<Record<string,CloudSyncStamp>>({});
  const cloudStampsRef=useRef<Record<string,CloudSyncStamp>>({});
  const [cloudRecords,setCloudRecords]=useState<CloudJobSummary[]>([]);
  const [cloudListed,setCloudListed]=useState(false);
  const [cloudBusy,setCloudBusy]=useState('');
  const [cloudMessage,setCloudMessage]=useState('');
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [providerError, setProviderError] = useState('');
  const [testingConnection,setTestingConnection]=useState(false);
  const [connectionTest,setConnectionTest]=useState<{ok:boolean;message:string;provider?:string;model?:string;cost?:number|null}|null>(null);
  const [view, setView] = useState<'today' | 'reports' | 'settings'>('today');
  const [selectedId, setSelectedId] = useState('');
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>(companies[0] ? [companies[0].id] : []);
  const [type, setType] = useState<ResearchType>('results');
  const [question, setQuestion] = useState(DEFAULT_QUESTIONS.results);
  const [runningId, setRunningId] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editor, setEditor] = useState('');
  const [editing, setEditing] = useState(false);
  const [savingEditor, setSavingEditor] = useState(false);
  const [planCount, setPlanCount] = useState(3);
  const [printJob, setPrintJob] = useState<ResearchJob | null>(null);
  const [deleteId, setDeleteId] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const pauseRef = useRef(false);
  const mountedRef = useRef(true);
  const startingRef=useRef(false);
  const pendingStartRef=useRef<{companyId:string;type?:ResearchType;question?:string}|null>(null);
  const selected = jobs.find(job => job.id === selectedId);
  const strategicSelected = selectedCompanies.some(id => isStrategicCompany(companies.find(company => company.id === id)));
  const dirty = !!selected?.report && editor !== (selected.editedText ?? reportText(selected));
  const companyName = (id: string) => companies.find(company => company.id === id)?.name || getResearchIssuer(id)?.name || id;
  const pending = jobs.filter(job => ['queued', 'paused'].includes(job.status));
  const reportJobs = jobs.filter(job => job.report);
  const completedToday = jobs.filter(job => job.day === today() && job.status === 'ready').length;
  const automaticCompanies = companies.filter(company=>!company.id.startsWith('listed-'));
  const sourcesToday = jobs.filter(job => job.day === today() && job.status === 'sources_only').length;
  const visibleJobs = jobs.filter(job => (filter === 'all' || (filter === 'reports' ? !!job.report : job.status === filter)) && `${job.question} ${job.companyIds.map(companyName).join(' ')} ${job.report?.title || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const suggestions = useMemo(() => {
    const lastChecked = (id: string) => jobs.filter(job => job.collectedCompanyIds.includes(id) || (job.companyIds.includes(id) && ['ready', 'sources_only', 'no_change'].includes(job.status))).reduce((last, job) => job.updatedAt > last ? job.updatedAt : last, '');
    return companies.filter(company=>!company.id.startsWith('listed-')).sort((a, b) => lastChecked(a.id).localeCompare(lastChecked(b.id))).slice(0, planCount);
  }, [companies, jobs, planCount]);

  function updateState(next: ResearchJob[]) { jobsRef.current = next; if (mountedRef.current) setJobs(next); }
  async function persist(job: ResearchJob) {
    const next = { ...job, updatedAt: new Date().toISOString() };
    try { await saveResearchJob(next); } catch (error) { setStorageError(errorMessage(error)); throw error; }
    updateState([next, ...jobsRef.current.filter(x => x.id !== next.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    return next;
  }
  async function checkProvider() {
    setProviderError('');
    try {
      const response = await fetch('/api/research/status', { cache: 'no-store' });
      if (!response.ok) throw new Error('تعذّر التحقق من ربط نموذج الذكاء الاصطناعي.');
      const data = await response.json() as ProviderStatus;
      if (typeof data.configured !== 'boolean' || !['ai', 'sources_only'].includes(data.mode)) throw new Error('حالة ربط النموذج غير مكتملة.');
      setProvider(data);
    } catch (error) { setProvider(null); setProviderError(errorMessage(error)); }
  }
  useEffect(() => {
    mountedRef.current = true;
    readResearchJobs().then(async saved => {
      const recovered = saved.map(job => ['collecting', 'drafting'].includes(job.status) ? { ...job, status: 'paused' as TaskStatus, stage: 'توقف التنفيذ عند إغلاق الصفحة. يمكنك الاستئناف.' } : job);
      if (recovered.some((job, i) => job !== saved[i])) await saveResearchJobs(recovered);
      if (mountedRef.current) { updateState(recovered); setSelectedId(recovered[0]?.id || ''); setLoaded(true); }
    }).catch(error => { if (mountedRef.current) { setStorageError(errorMessage(error)); setLoaded(true); } });
    checkProvider();
    return () => { mountedRef.current = false; pauseRef.current = true; controllerRef.current?.abort(); };
  }, []);
  useEffect(() => { const open = (event: Event) => { const next = (event as CustomEvent).detail; if (next === 'today' || next === 'reports') setView(next); }; window.addEventListener('drast:open-research', open); return () => window.removeEventListener('drast:open-research', open); }, []);
  useEffect(() => {
    if (strategicSelected && type === 'results') { setType('event'); if (Object.values(DEFAULT_QUESTIONS).includes(question)) setQuestion(STRATEGIC_QUESTION); }
  }, [strategicSelected, type, question]);
  useEffect(() => {
    if (selected) { setEditor(selected.editedText ?? reportText(selected)); setEditing(false); }
  }, [selectedId, selected?.report, selected?.editedText]);
  useEffect(()=>{void refreshCloudStatus();readCloudSyncStamps().then(stamps=>{const map=Object.fromEntries(stamps.map(stamp=>[stamp.id,stamp]));cloudStampsRef.current=map;setCloudStamps(map);}).catch(error=>setCloudMessage(errorMessage(error)));},[]);
  useEffect(() => { if (editing) editorRef.current?.focus(); }, [editing]);
  useEffect(() => { if (message) { const timer = setTimeout(() => setMessage(''), 7000); return () => clearTimeout(timer); } }, [message]);
  useEffect(() => {
    if (!printJob) return;
    document.body.classList.add('pilot-print-mode');
    const clean = () => { document.body.classList.remove('pilot-print-mode'); setPrintJob(null); };
    window.addEventListener('afterprint', clean, { once: true });
    const frame = requestAnimationFrame(() => { window.print(); });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('afterprint', clean); document.body.classList.remove('pilot-print-mode'); };
  }, [printJob]);

  function makeJob(companyIds: string[], taskType: ResearchType, taskQuestion: string, extra: Partial<ResearchJob> = {}): ResearchJob {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), companyIds, type: taskType, question: taskQuestion.trim(), status: 'queued', createdAt: now, updatedAt: now, day: today(), evidence: [], issues: [], collectedCompanyIds: [], ...extra };
  }
  async function startImmediate(companyIds:string[],taskType:ResearchType,taskQuestion:string){
    if(dirty){setMessage('احفظ التعديلات أو ألغِها قبل بدء دراسة أخرى.');return;}
    if(!loaded||storageError){setMessage(storageError||'تُفتح مساحة الحفظ الآن. حاول بعد لحظة.');return;}
    if(startingRef.current||runningRef.current){if(runningId)setSelectedId(runningId);setMessage('هناك دراسة قيد التنفيذ. يمكنك إيقافها مؤقتًا من التقرير.');return;}
    if(!companyIds.length||companyIds.length>3||companyIds.some(id=>!companies.some(company=>company.id===id))||!taskQuestion.trim())return;
    if(taskType==='results'&&companyIds.some(id=>isStrategicCompany(companies.find(company=>company.id===id)))){setMessage('الجهات غير المدرجة تُدرس استراتيجيًا، دون نتائج ربعية.');return;}
    startingRef.current=true;
    try{
      setView('today');
      const existing=jobsRef.current.find(job=>job.type===taskType&&job.question.trim()===taskQuestion.trim()&&[...job.companyIds].sort().join()===[...companyIds].sort().join()&&!job.report&&['queued','paused','failed','blocked'].includes(job.status));
      const job=existing||await persist(makeJob(companyIds,taskType,taskQuestion));
      setSelectedId(job.id);setEditing(false);setMessage('');
      await runQueue(job.id);
    }catch(error){setMessage(errorMessage(error));}finally{startingRef.current=false;}
  }
  async function startRequested(detail:{companyId:string;type?:ResearchType;question?:string}){
    const company=companies.find(item=>item.id===detail.companyId);if(!company)return;
    const taskType=isStrategicCompany(company)&&detail.type==='results'?'event':detail.type||dailyType(company);
    const taskQuestion=detail.question?.trim()||(isStrategicCompany(company)?STRATEGIC_QUESTION:DEFAULT_QUESTIONS[taskType]);
    setSelectedCompanies([company.id]);setType(taskType);setQuestion(taskQuestion);setView('today');
    await startImmediate([company.id],taskType,taskQuestion);
  }
  async function queueCustom(event:React.FormEvent){event.preventDefault();await startImmediate(selectedCompanies,type,question);}
  async function queueDaily() {
    if (dirty) { setMessage('احفظ التعديلات أو ألغِها قبل إضافة خطة اليوم.'); return; }
    try {
      const newJobs = suggestions.filter(company => !jobsRef.current.some(job => job.day === today() && job.type === dailyType(company) && job.companyIds.length === 1 && job.companyIds[0] === company.id)).map(company => makeJob([company.id], dailyType(company), isStrategicCompany(company) ? STRATEGIC_QUESTION : DEFAULT_QUESTIONS.results));
      if (!newJobs.length) { setMessage('مهام خطة اليوم موجودة بالفعل. يمكنك تشغيلها من الطابور.'); return; }
      await saveResearchJobs(newJobs);
      updateState([...newJobs, ...jobsRef.current].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setSelectedId(newJobs[0].id); setMessage(`أُضيفت ${nf.format(newJobs.length)} مهام لخطة اليوم. يبدأ العمل عند الضغط على تشغيل الطابور.`);
    } catch (error) { setStorageError(errorMessage(error)); }
  }
  async function runJob(original: ResearchJob) {
    const controller = new AbortController(); controllerRef.current = controller;
    let job = original;
    const missingSources: string[] = [];
    setRunningId(job.id); setSelectedId(job.id);
    try {
      job = await persist({ ...job, status: 'collecting', error: undefined, issues: [], collectedCompanyIds: [], stage: 'يبدأ التحقق من المصادر الرسمية.' });
      const fingerprints: string[] = [];
      for (const companyId of job.companyIds) {
        if (pauseRef.current) throw new DOMException('Paused', 'AbortError');
        // Re-read every company after a pause so a resumed job never mixes stale source versions.
        job = await persist({ ...job, stage: `يجمع مصادر ${companyName(companyId)} · ${nf.format(job.companyIds.indexOf(companyId) + 1)} من ${nf.format(job.companyIds.length)}` });
        const data = await requestJSON('/api/research/collect', { companyId }, controller.signal);
        const evidence: Evidence[] = Array.isArray(data.evidence) ? data.evidence.filter((e: Evidence) => e && e.companyId === companyId && typeof e.text === 'string' && e.text.trim()) : [];
        if (!evidence.length && typeof data.summary === 'string') missingSources.push(`${companyName(companyId)} — ${data.summary}`);
        fingerprints.push(String(data.fingerprint || evidence.map(e => `${e.id}:${e.text}`).join('|')));
        job = await persist({ ...job, evidence: [...job.evidence.filter(e => e.companyId !== companyId), ...evidence], issues: [...new Set([...job.issues, ...(Array.isArray(data.issues) ? data.issues.map((x: unknown) => String(x)) : [])])], collectedCompanyIds: [...new Set([...job.collectedCompanyIds, companyId])] });
      }
      if (pauseRef.current) throw new DOMException('Paused', 'AbortError');
      if (!job.evidence.length) {
        await persist({ ...job, status: 'blocked', stage: 'لم تتوفر مادة مصدرية قابلة للقراءة؛ لم تُنشأ دراسة.', error: missingSources.join(' · ') || 'لم يتوفر نص إفصاح صالح. راجع تفاصيل المصادر ثم أعد المحاولة.' });
        return;
      }
      const fingerprint = await digestFingerprint(job, fingerprints);
      const duplicate = !job.forceVersion && jobsRef.current.find(previous => previous.id !== job.id && previous.fingerprint === fingerprint && previous.report && (previous.mode === 'ai' || provider?.configured === false));
      if (duplicate) {
        await persist({ ...job, fingerprint, status: 'no_change', duplicateOf: duplicate.id, stage: 'المصادر والسؤال مطابقان لمسودة محفوظة؛ لم تُكرر صياغتها.' });
        return;
      }
      job = await persist({ ...job, fingerprint, status: 'drafting', stage: provider?.configured ? 'يراجع النموذج الأدلة ويُعد مسودة موثقة.' : 'يُعد حصرًا للمصادر. حالة الربط الحية يحددها الخادم.' });
      const data = await requestJSON('/api/research/draft', { companyIds: job.companyIds, question: job.question, type: job.type, evidence: job.evidence, issues: job.issues }, controller.signal);
      if (pauseRef.current) throw new DOMException('Paused', 'AbortError');
      if (!data.report || !Array.isArray(data.report.sections) || !['ai', 'sources_only'].includes(data.mode)) throw new Error('تعذّر التحقق من بنية المسودة. لم تُعتمد كتقرير.');
      await persist({ ...job, report: data.report as ResearchReport, mode: data.mode, model: data.model, status: data.mode === 'ai' ? 'ready' : 'sources_only', completedAt: new Date().toISOString(), stage: data.mode === 'ai' ? 'المسودة جاهزة للمراجعة البشرية.' : typeof data.draftingWarning === 'string' ? 'حُفظ موجز الإفصاحات. الصياغة التحليلية لم تكتمل؛ راجع سبب التوقف في حدود البيانات.' : 'اكتمل حصر المصادر. افتح المراجع لمراجعة الأرقام.' });
    } catch (error) {
      const paused = pauseRef.current || (error instanceof DOMException && error.name === 'AbortError');
      try { await persist({ ...job, status: paused ? 'paused' : 'failed', error: paused ? undefined : errorMessage(error), stage: paused ? 'توقفت المهمة. يمكنك استئنافها مع إعادة التحقق من المصادر.' : job.status === 'drafting' ? 'تعذّر إعداد المسودة. المصادر التي جُمعت محفوظة.' : 'تعذّر إكمال جمع المصادر.' }); } catch { /* Keep the initial storage error visible. */ }
    } finally { controllerRef.current = null; setRunningId(''); }
  }
  async function runQueue(onlyId?: string) {
    if (dirty) { setMessage('احفظ التعديلات أو ألغِها قبل بدء التنفيذ.'); return; }
    if (runningRef.current || storageError || !loaded) return;
    runningRef.current = true; pauseRef.current = false;
    const work = async () => {
      if (onlyId) {
        const job = jobsRef.current.find(item => item.id === onlyId);
        if (job && !job.report) await runJob(job);
      } else {
        const ids = jobsRef.current.filter(item => ['queued', 'paused'].includes(item.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(item => item.id);
        for (const id of ids) {
          if (pauseRef.current) break;
          const job = jobsRef.current.find(item => item.id === id);
          if (job) await runJob(job);
        }
      }
    };
    try {
      if (navigator.locks) await navigator.locks.request('drast-research-runner', { ifAvailable: true }, async lock => { if (lock) await work(); else setMessage('البحث يعمل في تبويب آخر. عد إلى ذلك التبويب أو انتظر انتهاءه.'); });
      else await work();
    } finally { runningRef.current = false; setRunningId(''); }
  }
  function pause() { pauseRef.current = true; controllerRef.current?.abort(); }
  async function newVersion(job: ResearchJob) {
    try {
      const next = await persist(makeJob(job.companyIds, job.type, job.question, { previousId: job.id, forceVersion: true }));
      setSelectedId(next.id); setEditing(false); setView('today'); setMessage(''); await runQueue(next.id);
    } catch { /* Storage error is displayed separately. */ }
  }
  async function saveEditor() {
    if (!selected || !editor.trim()) return;
    setSavingEditor(true);
    try { await persist({ ...selected, editedText: editor, editedAt: new Date().toISOString() }); setEditing(false); setMessage('حُفظت التعديلات محليًا.'); } catch {} finally { setSavingEditor(false); }
  }
  function selectJob(id: string) {
    if (dirty) { setMessage('احفظ تعديلات المسودة أو ألغِها قبل فتح تقرير آخر.'); return; }
    setSelectedId(id); setEditing(false);
    if (window.matchMedia('(max-width: 900px)').matches) requestAnimationFrame(() => document.querySelector('.rd-detail')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  }
  async function restoreBackup(file: File) {
    try {
      if (runningRef.current) throw new Error('أوقف التنفيذ قبل استيراد نسخة احتياطية.');
      if (file.size > 15 * 1024 * 1024) throw new Error('الحد الأقصى للنسخة الاحتياطية 15 ميجابايت.');
      const restored = parseResearchBackup(JSON.parse(await file.text()), researchIssuerIds);
      const existing = new Set(jobsRef.current.map(job => job.id));
      const added = restored.filter(job => !existing.has(job.id));
      await saveResearchJobs(added);
      updateState([...added, ...jobsRef.current].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setMessage(`استُعيدت ${nf.format(added.length)} مهام جديدة. لم تتغير المهام الموجودة.`);
    } catch (error) { setMessage(errorMessage(error)); }
  }
  async function deleteJob(id: string) {
    try {
      await removeResearchJob(id); const nextStamps={...cloudStampsRef.current};delete nextStamps[id];cloudStampsRef.current=nextStamps;setCloudStamps(nextStamps); updateState(jobsRef.current.filter(job => job.id !== id));
      if (selectedId === id) setSelectedId(''); setDeleteId(''); setMessage('حُذفت المهمة محليًا. النسخة السحابية، إن وجدت، لم تُحذف.');
    } catch (error) { setMessage(errorMessage(error)); }
  }
  function exportReport(job: ResearchJob, format: 'txt' | 'json') {
    const body = format === 'txt' ? '\ufeff' + (job.editedText ?? reportText(job)) : JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), job }, null, 2);
    downloadFile(`drast-${job.id.slice(0, 8)}.${format}`, body, format === 'txt' ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8');
  }

  useEffect(()=>{
    const start=(event:Event)=>{const detail=(event as CustomEvent).detail;if(!detail||typeof detail.companyId!=='string')return;if(!loaded){pendingStartRef.current=detail;return;}void startRequested(detail);};
    window.addEventListener('drast:start-research',start);
    if(loaded&&pendingStartRef.current){const detail=pendingStartRef.current;pendingStartRef.current=null;void startRequested(detail);}
    return()=>window.removeEventListener('drast:start-research',start);
  },[loaded,storageError,dirty,provider,companies]);
  async function refreshCloudStatus(){
    try{const status=await checkCloudJobs();setCloudStatus(status);if(status.message)setCloudMessage(status.message);else setCloudMessage('');}
    catch(error){setCloudStatus(previous=>previous?{...previous,connected:false}:null);setCloudMessage(errorMessage(error));}
  }
  async function rememberCloud(stamp:CloudSyncStamp){await saveCloudSyncStamp(stamp);const next={...cloudStampsRef.current,[stamp.id]:stamp};cloudStampsRef.current=next;setCloudStamps(next);}
  async function uploadLocalJobs(){
    if(cloudBusy||runningRef.current||dirty||!cloudStatus?.connected)return;
    setCloudBusy('upload');setCloudMessage('');let saved=0,conflicts=0,failed=0;
    try{const snapshot=[...jobsRef.current];for(const job of snapshot){const previous=cloudStampsRef.current[job.id];if(previous?.localUpdatedAt===job.updatedAt)continue;try{const stored=await uploadCloudJob(job,previous?.version||null);saved++;await rememberCloud({id:job.id,version:stored.version,localUpdatedAt:job.updatedAt,cloudUpdatedAt:stored.updatedAt});}catch(error){if((error as Error&{code?:string}).code==='conflict'){conflicts++;continue;}failed++;setCloudMessage(errorMessage(error));break;}}
      setCloudMessage(`تأكد حفظ ${nf.format(saved)} نسخة على Supabase.${conflicts?` تعارضت ${nf.format(conflicts)} مهام؛ لم تُستبدل النسخ الأحدث.`:''}${failed?' لم يكتمل رفع بقية المهام؛ النسخ المحلية محفوظة.':''}${!saved&&!conflicts&&!failed?' لا توجد تعديلات محلية جديدة للرفع.':''}`);
      if(saved)setCloudStatus(previous=>({...previous,configured:true,connected:true}));
    }finally{setCloudBusy('');}
  }
  async function loadCloudList(){if(cloudBusy)return;setCloudBusy('list');setCloudMessage('');try{const records=await listCloudJobs();setCloudRecords(records);setCloudListed(true);setCloudStatus(previous=>({...previous,configured:true,connected:true}));setCloudMessage(`قُرئت ${nf.format(records.length)} نسخة سحابية. لم تتغير أي مهمة محلية.`);}catch(error){setCloudMessage(errorMessage(error));setCloudStatus(previous=>previous?{...previous,connected:false}:null);}finally{setCloudBusy('');}}
  async function restoreCloudRecord(record:CloudJobSummary,asCopy=false){
    const stored=await fetchCloudJob(record.id);const parsed=parseResearchBackup({schemaVersion:1,job:stored.job},companies.map(company=>company.id))[0];
    if(!asCopy&&jobsRef.current.some(job=>job.id===parsed.id))return false;
    const restored=asCopy?{...parsed,id:crypto.randomUUID(),previousId:parsed.id,stage:'استُعيدت هذه النسخة السحابية كملف مستقل؛ بقيت النسخة المحلية الأصلية.'}:parsed;
    const local=await persist(restored);
    if(!asCopy)await rememberCloud({id:local.id,version:stored.version,localUpdatedAt:local.updatedAt,cloudUpdatedAt:stored.updatedAt});
    return true;
  }
  async function restoreCloudJobs(record?:CloudJobSummary){
    if(cloudBusy||runningRef.current||dirty||storageError)return;setCloudBusy('restore');setCloudMessage('');let restored=0;
    try{const records=record?[record]:cloudRecords.filter(item=>!jobsRef.current.some(job=>job.id===item.id));for(const item of records){if(await restoreCloudRecord(item,!!record&&jobsRef.current.some(job=>job.id===item.id)))restored++;}setCloudMessage(`استُعيدت ${nf.format(restored)} مهام. لم تُستبدل أي نسخة محلية أو تعديلات محفوظة.`);}catch(error){setCloudMessage(`${restored?`استُعيدت ${nf.format(restored)} مهام. `:''}${errorMessage(error)}`);}finally{setCloudBusy('');}
  }

  async function testConnection(){
    setTestingConnection(true);setConnectionTest(null);
    try{const response=await fetch('/api/research/connection',{method:'POST'});const result=await response.json() as {ok?:boolean;error?:string;reply?:string;provider?:string;model?:string;cost?:number|null};if(!response.ok||!result.ok)throw new Error(result.error||'لم ينجح اختبار الاتصال بالنموذج.');setConnectionTest({ok:true,message:result.reply||'نجح اختبار توليد الرد.',provider:result.provider,model:result.model,cost:result.cost});await checkProvider();}
    catch(error){setConnectionTest({ok:false,message:errorMessage(error)});}finally{setTestingConnection(false);}
  }

  return <section className="research-desk" aria-label="مكتب البحث والدراسات">
    <div className="rd-toolbar">
      <div className="rd-tabs" role="group" aria-label="أقسام مكتب البحث">
        <button className={view === 'today' ? 'active' : ''} onClick={() => setView('today')}><CalendarDays size={17}/>بحث جديد</button>
        <button className={view === 'reports' ? 'active' : ''} onClick={() => setView('reports')}><FolderArchive size={17}/>المهام والتقارير<span>{nf.format(jobs.length)}</span></button>
        <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}><HardDrive size={17}/>الحفظ والربط</button>
      </div>
      <span className={`rd-provider-pill ${connectionTest?.ok ? 'is-connected' : ''}`}><span/>{connectionTest?.ok?'نجح اختبار AI':provider ? provider.configured ? 'إعداد AI متاح' : 'وضع جمع المصادر' : providerError ? 'تعذّر فحص الربط' : 'يتحقق من الربط'}</span>
    </div>
    {view==='settings'&&<div className="rd-local-note"><ShieldCheck size={17}/><p>مساحة خاصة · النسخة المحلية محفوظة في هذا المتصفح. رفع النسخ إلى Supabase واستعادتها يدويان من الأزرار أدناه. إغلاق التبويب يوقف المهام غير المكتملة؛ الحفظ السحابي لا يشغّلها في الخلفية.</p><button onClick={() => setView('settings')}>نسخة احتياطية<ArrowLeft size={14}/></button></div>}
    {storageError && <div className="rd-alert error" role="alert"><TriangleAlert size={20}/><div><strong>الحفظ المحلي غير متاح</strong><p>{storageError} لم يبدأ أي تنفيذ جديد.</p></div><button className="btn secondary" onClick={() => location.reload()}>إعادة فتح</button></div>}
    {providerError && <div className="rd-alert" role="status"><TriangleAlert size={18}/><p>{providerError}</p><button onClick={checkProvider}>إعادة التحقق</button></div>}
    {message && <div className="rd-message" role="status"><CheckCircle2 size={18}/><span>{message}</span><button onClick={() => setMessage('')} aria-label="إغلاق التنبيه"><X size={17}/></button></div>}
    {!loaded ? <div className="rd-loading" role="status"><LoaderCircle className="spin"/>يفتح مكتب البحث المحفوظ في متصفحك…</div> : <>
      {view === 'today' && <details className="rd-advanced-options"><summary>خيارات البحث والخطة<ChevronDown size={16}/></summary><div className="rd-advanced-body">
        <div className="rd-stats">
          <div><span className="rd-stat-icon violet"><ListTodo size={20}/></span><span>بانتظار التشغيل<strong>{nf.format(pending.length)}<small>مهام</small></strong></span></div>
          <div><span className="rd-stat-icon mint"><FilePenLine size={20}/></span><span>مسودات دراسة اليوم<strong>{nf.format(completedToday)}<small>للمراجعة</small></strong></span></div>
          <div><span className="rd-stat-icon peach"><BookOpen size={20}/></span><span>حصر مصادر اليوم<strong>{nf.format(sourcesToday)}<small>دون تحليل AI</small></strong></span></div>
          <div className="rd-stat-date"><CalendarDays size={19}/><span>خطة اليوم بتوقيت الرياض<strong>{new Intl.DateTimeFormat('ar-SA', { day: 'numeric', month: 'long', timeZone: 'Asia/Riyadh', calendar: 'gregory' }).format(new Date())}</strong></span></div>
        </div>
        <div className="rd-work-grid">
          <div className="rd-plan rd-panel">
            <div className="rd-section-heading"><div><span className="eyebrow">تغطية تتجدد</span><h2>من أين نبدأ اليوم؟</h2></div><span className="rd-light-icon"><Sparkles size={23}/></span></div>
            <p className="rd-subtext">نبدأ بالجهات الأقدم فحصًا. حصر المصادر يجدّد التغطية ويُحسب منفصلًا عن الدراسات.</p>
            <div className="rd-plan-count"><span>حجم خطة اليوم</span><div>{[2, 3].map(count => <button key={count} className={planCount === count ? 'active' : ''} onClick={() => setPlanCount(count)} aria-pressed={planCount === count}>{nf.format(count)} مهام</button>)}</div></div>
            <div className="rd-suggestions">{suggestions.map((company, i) => { const added = jobs.some(job => job.day === today() && job.companyIds.length === 1 && job.companyIds[0] === company.id && job.type === dailyType(company)); return <div className="rd-suggestion" key={company.id}><span className="rd-suggestion-index">{nf.format(i + 1).padStart(2, '٠')}</span><div><strong>{company.name}</strong><span>{company.sector} · {company.ticker}</span></div><span className={added ? 'rd-suggestion-added' : 'rd-suggestion-type'}>{added ? <><Check size={13}/>في خطة اليوم</> : isStrategicCompany(company) ? 'مراجعة استراتيجية' : 'مراجعة النتائج'}</span></div>; })}</div>
            <button className="btn primary rd-wide" onClick={queueDaily} disabled={!!storageError || !suggestions.length}><Plus size={17}/>إضافة الخطة إلى الطابور<ArrowLeft size={17}/></button>
            <p className="rd-small-note"><Clock3 size={14}/>تعمل الخطة عند تشغيلها. الجدولة اليومية التلقائية غير مفعّلة في هذه النسخة.</p>
          </div>
          <form className="rd-task-form rd-panel" id="research-task-form" onSubmit={queueCustom}>
            <div className="rd-section-heading"><div><span className="eyebrow">كل سؤال يستحق بحثًا</span><h2>مهمة بحث جديدة</h2></div><span className="rd-light-icon blue"><Search size={23}/></span></div>
            <label className="rd-label" htmlFor="rd-type">نوع المهمة</label><div className="rd-select"><select id="rd-type" value={type} onChange={event => { const next = event.target.value as ResearchType; setType(next); if ([...Object.values(DEFAULT_QUESTIONS), STRATEGIC_QUESTION].includes(question)) setQuestion(strategicSelected ? STRATEGIC_QUESTION : DEFAULT_QUESTIONS[next]); }}><option value="results" disabled={strategicSelected}>نتائج مالية</option><option value="event">أثر خبر أو حدث</option><option value="sector">مقارنة قطاعية</option></select><ChevronDown size={17}/></div>
            <fieldset className="rd-companies"><legend>نطاق الدراسة <span>اختر حتى ٣ جهات</span></legend><div>{companies.filter(company=>!company.id.startsWith('listed-')||selectedCompanies.includes(company.id)).map(company => <label key={company.id} className={selectedCompanies.includes(company.id) ? 'selected' : ''}><input type="checkbox" value={company.id} checked={selectedCompanies.includes(company.id)} disabled={!selectedCompanies.includes(company.id) && selectedCompanies.length >= 3} onChange={event => setSelectedCompanies(current => event.target.checked ? [...current, company.id] : current.filter(id => id !== company.id))}/><span className="rd-checkbox">{selectedCompanies.includes(company.id) && <Check size={12}/>}</span>{company.name}<small>{company.ticker}</small></label>)}</div></fieldset>
            <label className="rd-label" htmlFor="rd-question">ما الذي تريد معرفته؟</label><textarea id="rd-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="مثال: ما أسباب تغير الأرباح؟ وهل يؤكد التدفق النقدي هذا التحسن؟" required maxLength={2000} rows={4}/>
            {strategicSelected && <p className="rd-small-note">الجهات غير المدرجة تُدرس استراتيجيًا عبر حدث أو مقارنة قطاعية، ولا تدخل في محرك الأرباع المالية.</p>}
            {type === 'event' && <p className="rd-small-note">اذكر الحدث وتاريخه في السؤال. المصادر المتاحة حاليًا تركز على الإفصاحات الرسمية؛ قد لا تشمل كل الأخبار.</p>}
            <button type="submit" className="btn secondary rd-wide" disabled={!selectedCompanies.length || !question.trim() || !!storageError || !!runningId}><Plus size={17}/>ابدأ الدراسة</button>
          </form>
        </div>
      </div></details>}
      {(view === 'today' || view === 'reports') && <div className={`rd-results-grid ${view==='today'?'rd-direct-results':''}`} id="research-queue">
        <div className="rd-queue rd-panel">
          <div className="rd-section-heading"><div><span className="eyebrow">من السؤال إلى المسودة</span><h2>{view === 'reports' ? 'المهام والتقارير' : 'طابور البحث'}<small>{nf.format(view === 'reports' ? jobs.length : pending.length)}</small></h2></div>{runningId ? <button className="btn secondary compact" onClick={pause}><Pause size={15}/>إيقاف مؤقت</button> : <button className="btn primary compact" onClick={() => runQueue()} disabled={!pending.length || !!storageError}><Play size={15}/>تشغيل الطابور</button>}</div>
          {view === 'reports' && <div className="rd-queue-filters"><div className="rd-search"><Search size={16}/><input aria-label="البحث في المهام والتقارير" placeholder="ابحث بجهة أو سؤال…" value={search} onChange={event => setSearch(event.target.value)}/></div><select aria-label="تصفية حالة المهام" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">جميع الحالات</option><option value="reports">تقارير محفوظة</option><option value="ready">مسودات AI</option><option value="sources_only">حصر مصادر</option><option value="queued">في الطابور</option><option value="paused">متوقفة مؤقتًا</option><option value="failed">تحتاج متابعة</option><option value="blocked">تحتاج مصادر</option></select></div>}
          {!jobs.length ? <div className="rd-empty"><span><Inbox size={30}/></span><h3>مكتبك جاهز لأول مهمة</h3><p>ابحث باسم الجهة أو رمز التداول، ثم ابدأ الدراسة.</p></div> : !(view === 'reports' ? visibleJobs : jobs).length ? <div className="rd-empty"><Search size={25}/><p>لا توجد مهام تطابق البحث.</p></div> : <div className="rd-job-list">{(view === 'reports' ? visibleJobs : jobs).slice(0, view === 'reports' ? 1000 : 12).map(job => <button key={job.id} className={`rd-job ${selectedId === job.id ? 'selected' : ''}`} onClick={() => selectJob(job.id)} aria-pressed={selectedId === job.id}><span className={`rd-job-icon ${job.status}`}>{['collecting', 'drafting'].includes(job.status) ? <LoaderCircle size={20} className="spin"/> : job.report ? <FileText size={20}/> : job.status === 'no_change' ? <History size={20}/> : <Search size={20}/>}</span><span className="rd-job-copy"><strong>{job.companyIds.map(companyName).join('، ')}</strong><span>{job.report?.title || job.question}</span><small>{typeLabels[job.type]}<i/> {date(job.createdAt)}</small></span><span className="rd-job-end"><span className={`rd-status ${job.status}`}>{statusLabels[job.status]}</span><ChevronLeft size={17}/></span></button>)}</div>}
          {view === 'today' && jobs.length > 12 && <button className="rd-all-link" onClick={() => setView('reports')}>عرض جميع المهام والتقارير<ArrowLeft size={15}/></button>}
          <div className="rd-queue-foot"><ShieldCheck size={14}/>{runningId ? 'اترك هذا التبويب مفتوحًا حتى تنتهي المهمة.' : 'كل مسودة تحتفظ بالسؤال والمصادر وتاريخ الجمع.'}</div>
        </div>
        <div className="rd-detail rd-panel" aria-label="تفاصيل المهمة والتقرير">
          {!selected ? <div className="rd-detail-empty"><div className="rd-doc-illustration"><FileText size={46}/><span><Check size={18}/></span></div><span className="eyebrow">تقريرك في مكان واحد</span><h2>ابدأ بالاسم أو رمز التداول</h2><p>اختر جهة من البحث أعلاه واضغط «ابدأ الدراسة».</p><div><span><BookOpen size={16}/>مصادر مرتبطة</span><span><FilePenLine size={16}/>تحرير داخل المنصة</span><span><Printer size={16}/>جاهز للطباعة</span></div></div> : <>
            <div className="rd-detail-header"><div><span className={`rd-status ${selected.status}`}>{statusLabels[selected.status]}</span><h2>{selected.report?.title || selected.companyIds.map(companyName).join('، ')}</h2><p>{typeLabels[selected.type]} · {date(selected.createdAt)}</p></div>{selected.id===runningId&&<button className="btn secondary compact" onClick={pause}><Pause size={14}/>إيقاف مؤقت</button>}{!['collecting', 'drafting'].includes(selected.status) && <button className="rd-icon-button" aria-label="حذف المهمة" title="حذف المهمة" onClick={() => setDeleteId(selected.id)}><X size={17}/></button>}</div>
            {deleteId === selected.id && <div className="rd-delete-confirm" role="alert"><p>حذف هذه المهمة ومصادرها وتقريرها من هذا المتصفح؟ النسخة السحابية، إن وجدت، تبقى.</p><button onClick={() => deleteJob(selected.id)}>تأكيد الحذف</button><button onClick={() => setDeleteId('')}>إلغاء</button></div>}
            <div className="rd-question"><span>سؤال البحث</span><p>{selected.question}</p></div>
            <div className="rd-process"><div className={selected.collectedCompanyIds.length ? 'done' : ['collecting'].includes(selected.status) ? 'current' : ''}><span>{selected.collectedCompanyIds.length ? <Check size={13}/> : '١'}</span><strong>جمع الأدلة</strong><small>{nf.format(selected.evidence.length)} مصدر</small></div><span className="rd-process-line"/><div className={selected.report ? 'done' : selected.status === 'drafting' ? 'current' : ''}><span>{selected.report ? <Check size={13}/> : '٢'}</span><strong>{selected.mode === 'sources_only' ? 'حصر المصادر' : 'صياغة المسودة'}</strong><small>{selected.mode === 'ai' ? 'نموذج AI' : selected.mode === 'sources_only' ? 'دون نموذج AI' : 'بعد اكتمال الجمع'}</small></div><span className="rd-process-line"/><div className={selected.editedAt ? 'done' : ''}><span>{selected.editedAt ? <Check size={13}/> : '٣'}</span><strong>مراجعتك</strong><small>{selected.editedAt ? 'حُفظت التعديلات' : 'لم تُسجل تعديلات'}</small></div></div>
            {selected.stage && <div className={`rd-stage ${selected.status === 'failed' || selected.status === 'blocked' ? 'has-error' : ''}`}>{['collecting', 'drafting'].includes(selected.status) ? <LoaderCircle size={17} className="spin"/> : selected.status === 'ready' || selected.status === 'sources_only' ? <CheckCircle2 size={17}/> : <Clock3 size={17}/>}<span>{selected.stage}</span></div>}
            {selected.error && <div className="rd-alert error" role="alert"><TriangleAlert size={18}/><p>{selected.error}</p></div>}
            {selected.status==='blocked'&&selected.companyIds.some(id=>!getResearchConnector(id))&&<button className="btn secondary" onClick={onOpenLibrary}>فتح مكتبة المصادر</button>}
            {!selected.report && !['collecting', 'drafting', 'no_change'].includes(selected.status) && <button className="btn primary rd-wide" onClick={() => runQueue(selected.id)} disabled={!!runningId || !!storageError}><Play size={16}/>{selected.status === 'queued' ? 'بدء هذه المهمة' : 'استئناف وجمع أحدث المصادر'}</button>}
            {selected.mode==='sources_only'&&selected.report&&provider?.configured&&selected.evidence.every(source=>!libraryEvidenceId(source.url))&&<button className="btn secondary" disabled={!!runningId||dirty} onClick={()=>newVersion(selected)}>إعادة محاولة الصياغة التحليلية</button>}
            {selected.status === 'no_change' && <div className="rd-no-change"><p>لم تتغير الأدلة والسؤال عن المسودة السابقة. يمكنك مراجعتها أو طلب نسخة جديدة صراحةً.</p><div><button className="btn secondary compact" onClick={() => selectJob(selected.duplicateOf || '')}>فتح المسودة السابقة</button><button className="btn secondary compact" onClick={() => newVersion(selected)}>طلب نسخة جديدة</button></div></div>}
            {selected.report && <>
              <div className={`rd-report-notice ${selected.mode === 'sources_only' ? 'sources-only' : ''}`}><span>{selected.mode === 'sources_only' ? <BookOpen size={19}/> : <Sparkles size={19}/>}</span><div><strong>{selected.mode === 'sources_only' ? 'حصر مصادر، وليس دراسة مكتملة' : 'مسودة دراسة آلية تحتاج مراجعتك'}</strong><p>{selected.mode === 'sources_only' ? 'جمعت المنصة المادة المتاحة وسجّلت حدودها. فعّل نموذج AI الخاص بالمشروع لإعداد تحليل يستند إليها.' : 'راجع الأرقام والفترات والإسناد قبل اعتماد التقرير. الاستنتاجات والسيناريوهات مميزة عن الحقائق.'}</p></div></div>
              <div className="rd-report-tools"><button className={`btn ${editing ? 'primary' : 'secondary'} compact`} onClick={() => setEditing(true)} disabled={editing || !!runningId}><FilePenLine size={15}/>تحرير المسودة</button><button className="btn secondary compact" onClick={() => setPrintJob(selected)} disabled={dirty}><Printer size={15}/>طباعة / PDF</button><div className="rd-export-menu"><button className="rd-icon-text" onClick={() => exportReport(selected, 'txt')} disabled={dirty}><Download size={15}/>TXT</button><button className="rd-icon-text" onClick={() => exportReport(selected, 'json')} disabled={dirty}>JSON</button></div></div>
              {editing ? <div className="rd-editor"><label htmlFor="rd-report-editor">نص التقرير <span>المصدر الأصلي محفوظ؛ الحفظ يسجل نسختك المعدّلة.</span></label><textarea id="rd-report-editor" ref={editorRef} value={editor} onChange={event => setEditor(event.target.value)} rows={22} maxLength={300000}/><div><button className="btn primary compact" onClick={saveEditor} disabled={!editor.trim() || !dirty || savingEditor || !!storageError}>{savingEditor ? <LoaderCircle size={15} className="spin"/> : <Save size={15}/>}حفظ التعديلات</button><button className="btn secondary compact" onClick={() => { setEditor(selected.editedText ?? reportText(selected)); setEditing(false); }}>إلغاء التعديل</button>{dirty && <span className="rd-unsaved">تعديلات غير محفوظة</span>}</div></div> : selected.editedText !== undefined ? <article className="rd-report"><div className="rd-edited"><Check size={14}/>نسخة محررة · {selected.editedAt && date(selected.editedAt)}</div><div className="rd-plain-report">{selected.editedText}</div></article> : <article className="rd-report"><p className="rd-report-summary">{selected.report.summary}</p>{selected.report.sections.map((section, i) => <section key={`${section.title}-${i}`}><span className={`rd-kind ${section.kind}`}>{kindLabels[section.kind]}</span><h3>{section.title}</h3><p>{section.body}</p>{section.sourceIds.length > 0 && <div className="rd-citation-links">{section.sourceIds.map(id => { const source = selected.evidence.find(e => e.id === id); return source && (isSafeSourceUrl(source.url) || libraryEvidenceId(source.url)) ? <a key={id} href={source.url} target="_blank" rel="noopener noreferrer">[{id}]<ArrowUpLeft size={12}/></a> : <span key={id}>[{id}] {source ? 'رابط غير متاح' : 'إسناد يحتاج مراجعة'}</span>; })}</div>}</section>)}{selected.report.limitations.length > 0 && <section className="rd-limitations"><h3><TriangleAlert size={17}/>حدود البيانات</h3><ul>{selected.report.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul></section>}{selected.report.nextWatch.length > 0 && <section className="rd-watch-next"><h3><CalendarDays size={17}/>ما نتابعه لاحقًا</h3><ul>{selected.report.nextWatch.map((item, i) => <li key={i}>{item}</li>)}</ul></section>}</article>}
              {selected.model && <div className="rd-model-caption">النموذج المستخدم: <span dir="ltr">{selected.model}</span></div>}
              <button className="rd-all-link" onClick={() => newVersion(selected)} disabled={dirty || !!storageError}><RefreshCw size={14}/>طلب إصدار جديد مع إبقاء هذه النسخة</button>
            </>}
            {selected.report&&renderFinancialCharts?.(selected.companyIds)}
            {(selected.evidence.length > 0 || selected.issues.length > 0) && <details className="rd-evidence" open={!selected.report}><summary><BookOpen size={17}/>الأدلة وحدود الجمع<span>{nf.format(selected.evidence.length)}</span><ChevronDown size={15}/></summary><div>{selected.evidence.map(source => <div className="rd-evidence-item" key={source.id}><div><span>{source.kind === 'pdf' ? 'PDF' : 'WEB'}</span><strong>{source.title}</strong></div>{(isSafeSourceUrl(source.url) || libraryEvidenceId(source.url)) ? <a href={source.url} target="_blank" rel="noopener noreferrer">فتح المصدر الأصلي<ExternalLink size={13}/></a> : <span>رابط المصدر غير متاح للفتح</span>}<p>{source.text.slice(0, 200)}{source.text.length > 200 ? '…' : ''}</p><small>جُمع: {date(source.checkedAt)}{source.pagesRead ? ` · قُرئت ${nf.format(source.pagesRead)} من ${nf.format(source.totalPages || source.pagesRead)} صفحات` : ''}{source.truncated ? ' · النص مقتطف وغير كامل' : ''}</small></div>)}{selected.issues.length > 0 && <div className="rd-collection-issues"><strong><TriangleAlert size={15}/>ملاحظات الجمع</strong><ul>{selected.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></div>}</div></details>}
          </>}
        </div>
      </div>}
      {view === 'settings' && <div className="rd-settings">
        <div className="rd-panel rd-connection"><div className="rd-section-heading"><div><span className="eyebrow">ربط مستقل للمشروع</span><h2>نموذج الذكاء الاصطناعي</h2></div><span className="rd-light-icon"><Sparkles size={24}/></span></div><div className={`rd-connection-state ${connectionTest?.ok ? 'connected' : ''}`}><span/>{provider ? provider.configured ? 'الإعداد متاح · الاتصال يُختبر عند التنفيذ' : 'لم يُهيّأ نموذج للتوليد بعد' : 'حالة الربط غير متاحة'}</div><p>تُرسل المادة المجمّعة إلى المزوّد المحدد لإعداد المسودة عند نجاح الاتصال. إعداد الربط وحده لا يؤكد نجاح التوليد.</p><dl><div><dt>المزوّد</dt><dd>{provider?.provider||'غير محدد'}</dd></div><div><dt>النموذج</dt><dd dir="ltr">{provider?.model || 'يُحدد في إعدادات الخادم'}</dd></div><div><dt>سياسة التكلفة</dt><dd>نماذج مجانية فقط · دون انتقال تلقائي إلى نموذج مدفوع</dd></div><div><dt>الوضع الحالي</dt><dd>{provider ? provider.configured ? 'جاهز لطلب مسودة AI؛ يتوقف عند تعذّر اتصال المزوّد' : 'حصر المصادر فقط؛ لا تُحتسب دراسة مكتملة' : 'غير معروف؛ أعد التحقق من الربط'}</dd></div></dl><p className="rd-small-note">تُحدد طريقة الربط في إعدادات هذا المشروع، وقد تستخدم صلاحيات الاستضافة أو مفتاح مزوّد اختياريًا. لا تُحفظ بيانات الربط السرية ضمن التقارير.</p><div className="rd-connection-actions"><button className="btn primary" onClick={testConnection} disabled={testingConnection}>{testingConnection?<LoaderCircle className="spin" size={16}/>:<Sparkles size={16}/>}اختبار الاتصال</button><button className="btn secondary" onClick={checkProvider}><RefreshCw size={16}/>تحديث الحالة</button></div>{connectionTest&&<div className={`rd-connection-test ${connectionTest.ok?'success':'error'}`} role="status">{connectionTest.ok?<CheckCircle2 size={17}/>:<TriangleAlert size={17}/>}<div><strong>{connectionTest.ok?'نجح اختبار التوليد':'لم ينجح الاتصال'}</strong><p>{connectionTest.message}</p>{connectionTest.ok&&<small>{connectionTest.provider} · <bdi>{connectionTest.model}</bdi>{connectionTest.cost===0?' · التكلفة المبلّغة: 0 دولار':''}</small>}</div></div>}</div>
        <div className="rd-panel rd-backup"><div className="rd-section-heading"><div><span className="eyebrow">نسختك تحت يدك</span><h2>الحفظ والنسخ الاحتياطي</h2></div><span className="rd-light-icon mint"><HardDrive size={24}/></span></div><div className="rd-backup-count"><strong>{nf.format(jobs.length)}</strong><span>مهمة محفوظة في هذا المتصفح<br/>{nf.format(reportJobs.length)} مسودة أو حصر مصادر</span></div><p>النسخ المحلية لا تنتقل بين الأجهزة تلقائيًا. استخدم الحفظ السحابي اليدوي أدناه أو صدّر ملفًا احتياطيًا؛ حذف بيانات الموقع قد يزيل النسخة المحلية.</p><div className="rd-backup-actions"><button className="btn primary" disabled={!!storageError || !jobs.length} onClick={() => downloadFile(`drast-backup-${today()}.json`, JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), jobs: jobsRef.current }, null, 2))}><Download size={17}/>تصدير النسخة الكاملة</button><button className="btn secondary" onClick={() => inputRef.current?.click()} disabled={!!storageError || !!runningId}><Upload size={17}/>استعادة نسخة</button><input type="file" ref={inputRef} accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) restoreBackup(file); event.target.value = ''; }}/></div><p className="rd-small-note">الاستعادة تضيف المهام الجديدة فقط، وتبقي نسختك الحالية. النسخة تتضمن نصوص المصادر والتقارير؛ احتفظ بها في مكان خاص.</p></div>
        <div className="rd-panel rd-backup"><div className="rd-section-heading"><div><span className="eyebrow">حفظ خاص عبر الخادم</span><h2>مهام البحث على Supabase</h2></div><span className="rd-light-icon mint"><Database size={23}/></span></div><div className={`rd-connection-state ${cloudStatus?.connected?'connected':''}`}><span/>{cloudStatus?.connected?'تم التحقق من الوصول إلى جدول المهام':cloudStatus?.configured?'الإعدادات موجودة؛ الاتصال غير مؤكد':cloudStatus?'الحفظ السحابي غير مهيّأ':'حالة الحفظ السحابي غير متاحة'}</div>{cloudStatus?.projectRef&&<p className="rd-small-note">معرّف المشروع المرتبط: <bdi>{cloudStatus.projectRef}</bdi></p>}<p>الرفع والاستعادة هنا عمليتان صريحتان. تُحفظ نسخة كل مهمة برقم إصدار؛ عند اختلاف النسخة السحابية يتوقف استبدالها وتبقى تعديلات الجهازين.</p><dl><div><dt>محليًا</dt><dd>{nf.format(jobs.length)} مهام · {nf.format(jobs.filter(job=>cloudStamps[job.id]?.localUpdatedAt!==job.updatedAt).length)} نسخ لم يتأكد رفع أحدث تعديل لها</dd></div><div><dt>قائمة السحابة</dt><dd>{cloudListed?`${nf.format(cloudRecords.length)} نسخ مقروءة من Supabase`:'لم تُجلب قائمة النسخ بعد'}</dd></div></dl><div className="rd-backup-actions"><button className="btn primary" onClick={uploadLocalJobs} disabled={!cloudStatus?.connected||!!cloudBusy||!!runningId||dirty||!!storageError||!jobs.length}>{cloudBusy==='upload'?<LoaderCircle size={16} className="spin"/>:<Upload size={16}/>}رفع النسخ المحلية</button><button className="btn secondary" onClick={loadCloudList} disabled={!cloudStatus?.configured||!!cloudBusy}>{cloudBusy==='list'?<LoaderCircle size={16} className="spin"/>:<Download size={16}/>}جلب قائمة السحابة</button><button className="btn secondary" onClick={refreshCloudStatus} disabled={!!cloudBusy}><RefreshCw size={15}/>فحص الاتصال</button></div>{dirty&&<p className="rd-small-note">احفظ تعديلات التقرير أولًا قبل الرفع أو الاستعادة.</p>}{cloudMessage&&<div className="rd-stage" role="status"><HardDrive size={16}/><span>{cloudMessage}</span></div>}{cloudListed&&<details className="rd-evidence"><summary>النسخ السحابية وخيارات الاستعادة<span>{nf.format(cloudRecords.length)}</span><ChevronDown size={15}/></summary><div className="rd-backup-actions"><button className="btn secondary" onClick={()=>restoreCloudJobs()} disabled={!!cloudBusy||!!runningId||dirty||!!storageError||!cloudRecords.some(record=>!jobs.some(job=>job.id===record.id))}><Download size={15}/>استعادة المهام غير الموجودة محليًا</button></div><p className="rd-small-note">المهام الموجودة لا تُستبدل. يمكنك استعادة أي نسخة منها كملف مستقل للمقارنة.</p>{cloudRecords.slice(0,30).map(record=><div className="rd-evidence-item" key={record.id}><strong>{record.question?.slice(0,140)||`مهمة ${record.id.slice(0,8)}`}</strong><p>حُفظت سحابيًا: {date(record.updatedAt)}</p><button className="btn secondary compact" onClick={()=>restoreCloudJobs(record)} disabled={!!cloudBusy||!!runningId||dirty||!!storageError}>{jobs.some(job=>job.id===record.id)?'استعادة كنسخة مستقلة':'استعادة هذه المهمة'}</button></div>)}{cloudRecords.length>30&&<p className="rd-small-note">تظهر أول ٣٠ نسخة هنا؛ زر الاستعادة يشمل جميع المهام الجديدة المقروءة.</p>}</details>}<p className="rd-small-note">مفاتيح Supabase تبقى في الخادم. نجاح فحص الاتصال لا يعني أن تعديلاتك رُفعت؛ يُذكر عدد النسخ بعد تأكيد الحفظ الفعلي.</p></div>
        <div className="rd-panel rd-scope"><span className="eyebrow">بداية قابلة للتوسع</span><h2>قائمة المتابعة</h2><p>{nf.format(automaticCompanies.length)} جهات في المتابعة، لكل منها سجل مستقل. تُقترح مهام يومية بحسب تاريخ الدراسات، ويمكنك تحديد جهة أو حتى ثلاث جهات في مهمة واحدة.</p><div>{automaticCompanies.map(company => <div key={company.id}><span className={`rd-company-initial ${company.id}`}>{company.name.replace('ال', '').slice(0, 1)}</span><strong>{company.name}</strong><span>{company.sector}</span><small>{company.ticker}</small></div>)}</div></div>
      </div>}
    </>}
    {printJob && createPortal(<div className="pilot-print-report" dir="rtl"><header><span>دراسات · مساحة البحث المالي</span><strong>{printJob.mode === 'sources_only' ? 'حصر مصادر · غير مكتمل كدراسة' : 'مسودة دراسة · للمراجعة البشرية'}</strong></header><div className="pilot-print-text">{printJob.editedText ?? reportText(printJob)}</div><footer>سؤال البحث: {printJob.question}<br/>هذه نسخة التقرير المحفوظة وقت التصدير، مع مصادرها وحدودها.</footer></div>, document.body)}
  </section>;
}

