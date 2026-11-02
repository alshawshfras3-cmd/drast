'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowUpLeft, BookOpen, Building2, Calculator, Check, CheckCircle2, ChevronDown, ExternalLink, FileCheck2, FilePenLine, FileSearch, FileText, FolderOpen, Layers3, ListFilter, Network, Printer, Search, ShieldCheck, Sparkles, TriangleAlert, X, Download } from 'lucide-react';
import { isSafeSourceUrl } from '@/lib/study-engine.mjs';

export type StrategicProfile = {
  id: string; name?: string; company?: string; displayName?: string; englishName?: string;
  entityKind?: string; sector?: string; asOf?: string; summary?: string; coverage?: string;
  findings?: { title?: string; body?: string; kind?: string; sourceIds?: string[]; citations?: string[] }[];
  sources?: { id: string; title?: string; url: string; publishedAt?: string | null; locator?: string; verification?: string }[];
  limitations?: string[]; nextWatch?: string[];
};
type FinancialStudy = { id: string; company: string; ticker: string; sector?: string; quarters?: unknown[]; coverage?: string; sources?: unknown[]; researchCompanyId?: string };
type ListedRecord = { name: string; ticker: string; market: string; sector?: string; searchAliases?: string[] };
export type ListedDirectory = { asOf?: string; sourceUrl?: string; sourceTitle?: string; sourceLanguage?: string; sourceAsOf?: string | null; coverage?: string; companies?: ListedRecord[] };
type Entity = { id: string; name: string; sourceName?: string; englishName?: string; ticker?: string; market?: string; sector?: string; searchAliases?: string[]; group: 'listed' | 'strategic'; tracked: boolean; hasStudy: boolean; study?: FinancialStudy; profile?: StrategicProfile };
const nf = new Intl.NumberFormat('ar-SA');
const names: Record<string, string> = { '4013': 'سليمان الحبيب', '2222': 'أرامكو السعودية', '2010': 'سابك', '7010': 'stc', '2280': 'المراعي', '1820': 'بان القابضة' };
const kindLabels: Record<string, string> = { fact: 'حقيقة من المصدر', management: 'تصريح أو توجه معلن', analysis: 'استنتاج تحليلي', scenario: 'سيناريو محتمل' };
function normalize(value: string) {
  return value.normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function profileName(profile: StrategicProfile) { return profile.name || profile.displayName || profile.company || profile.id; }
function marketName(market?: string) { return market === 'main' ? 'السوق الرئيسية' : market === 'nomu' ? 'نمو' : market || 'شركة مدرجة'; }
function scrollTo(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
}
function profileText(profile: StrategicProfile) {
  return [profileName(profile), profile.englishName || '', 'ملف استراتيجي لجهة غير مدرجة — ليس مقارنة أرباح ربعية', `تاريخ القطع: ${profile.asOf || 'غير مذكور'}`, '', 'الخلاصة', profile.summary || profile.coverage || 'لا توجد خلاصة متاحة.',
    ...(profile.findings || []).flatMap(finding => ['', `${finding.title || 'قراءة من الملف'} · ${kindLabels[finding.kind || 'analysis'] || 'قراءة منسوبة للمصدر'}`, finding.body || '', (finding.sourceIds || finding.citations || []).length ? `الإسناد: ${(finding.sourceIds || finding.citations || []).map(id => `[${id}]`).join('، ')}` : '']),
    '', 'حدود البيانات', ...(profile.limitations || []).map(item => `• ${item}`), '', 'ما نتابعه لاحقًا', ...(profile.nextWatch || []).map(item => `• ${item}`), '', 'المصادر', ...(profile.sources || []).map(source => `[${source.id}] ${source.title || source.id}\n${source.url}${source.publishedAt ? `\nتاريخ النشر: ${source.publishedAt}` : ''}${source.locator ? `\nموضع الدليل: ${source.locator}` : ''}`)].filter(item => item !== undefined).join('\n');
}
const platformRoles = [
  { title: 'منسق النطاق', icon: Network, state: 'منطق تنسيق فعلي', description: 'يرتب الجهات والأسئلة ونوع المهمة في طابور واضح، ثم ينفذ الخطوات عند تشغيلها.' },
  { title: 'جامع المصادر', icon: FileSearch, state: 'جمع بالكود', description: 'يجلب المادة من المصادر الرسمية التي هُيّئت للمتابعة، ويسجل الروابط وحدود القراءة.' },
  { title: 'الحسابات الحتمية', icon: Calculator, state: 'حسابات فعلية', description: 'يحسب المقارنات المالية للشركات المدرجة من الأرقام والفترات المسجلة؛ لا يخمّن القيم الناقصة.' },
  { title: 'محلل AI', icon: Sparkles, state: 'يتطلب نموذجًا مهيّأ', description: 'يصوغ مسودة من الأدلة عند تهيئة المزوّد ونجاح الاتصال، ويميّز الحقائق عن التفسير والسيناريوهات.' },
  { title: 'مراجع الإسناد', icon: FileCheck2, state: 'تحقق بالكود', description: 'يفحص بنية المسودة ومعرّفات المصادر. صحة الرقم وتفاصيل الجداول تحتاج أيضًا مراجعة بشرية.' },
  { title: 'المحرر', icon: FilePenLine, state: 'واجهة ومراجعة بشرية', description: 'يتيح لك مراجعة المسودة وتعديل نصها وحفظ نسختك وتصديرها وطباعتها من المنصة.' },
];

export default function EntityDirectory({ studies, profiles, directory, onOpenStudy, onStartResearch }: { studies: FinancialStudy[]; profiles: StrategicProfile[]; directory: ListedDirectory; onOpenStudy: (study: FinancialStudy) => void; onStartResearch?: (companyId: string) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'listed' | 'strategic'>('all');
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [printProfile, setPrintProfile] = useState<StrategicProfile | null>(null);
  const [limit, setLimit] = useState(24);
  const listed = Array.isArray(directory.companies) ? directory.companies : [];
  const tracked = useMemo<Entity[]>(() => [
    ...studies.map(study => {
      const record = listed.find(item => item.ticker === String(study.ticker));
      return { id: `listed-${study.ticker}`, name: names[study.ticker] || study.company, sourceName: record?.name, ticker: String(study.ticker), market: record?.market, sector: study.sector, searchAliases: record?.searchAliases, group: 'listed' as const, tracked: true, hasStudy: Array.isArray(study.quarters) && study.quarters.length > 0, study };
    }),
    ...profiles.map(profile => ({ id: `strategic-${profile.id}`, name: profileName(profile), englishName: profile.englishName, sector: profile.sector, group: 'strategic' as const, tracked: true, hasStudy: !!profile.summary && !!profile.findings?.length, profile })),
  ], [studies, profiles, listed]);
  const entities = useMemo<Entity[]>(() => {
    const trackedTickers = new Set(tracked.flatMap(entity => entity.ticker ? [entity.ticker] : []));
    const seen = new Set<string>();
    return [...tracked, ...listed.filter(record => { if (!record.ticker || trackedTickers.has(record.ticker) || seen.has(record.ticker)) return false; seen.add(record.ticker); return true; }).map(record => ({ id: `listed-${record.ticker}`, name: record.name, sourceName: record.name, ticker: String(record.ticker), market: record.market, sector: record.sector, searchAliases: record.searchAliases, group: 'listed' as const, tracked: false, hasStudy: false }))];
  }, [tracked, listed]);
  const searching = !!query.trim();
  const base = expanded || searching ? entities : tracked;
  const found = base.filter(entity => (filter === 'all' || entity.group === filter) && normalize(`${entity.name} ${entity.sourceName || ''} ${entity.englishName || ''} ${entity.ticker || ''} ${entity.sector || ''} ${(entity.searchAliases || []).join(' ')}`).includes(normalize(query)));
  const selected = entities.find(entity => entity.id === selectedId);
  const financialStudyCount = tracked.filter(entity => entity.group === 'listed' && entity.hasStudy).length;
  const profileCount = tracked.filter(entity => entity.group === 'strategic').length;
  const referenceOnlyCount = entities.filter(entity => !entity.tracked).length;
  useEffect(() => { setLimit(24); }, [query, filter, expanded]);
  useEffect(() => {
    if (!printProfile) return;
    document.body.classList.add('entity-print-mode');
    const clean = () => { document.body.classList.remove('entity-print-mode'); setPrintProfile(null); };
    window.addEventListener('afterprint', clean, { once: true });
    const frame = requestAnimationFrame(() => window.print());
    return () => { cancelAnimationFrame(frame); document.body.classList.remove('entity-print-mode'); window.removeEventListener('afterprint', clean); };
  }, [printProfile]);
  function openProfile(entity: Entity) { setSelectedId(entity.id); scrollTo('entity-profile-view'); }
  function exportProfile(profile: StrategicProfile) {
    const url = URL.createObjectURL(new Blob(['\ufeff' + profileText(profile)], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `drast-${profile.id}-profile.txt`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="entity-directory" id="entity-directory" aria-label="الفهرس والدراسات">
    <div className="ed-stats">
      <div><span className="ed-stat-icon purple"><Building2 size={20}/></span><span>جهات في المتابعة<strong>{nf.format(tracked.length)}<small>ملفات نشطة في المنصة</small></strong></span></div>
      <div><span className="ed-stat-icon mint"><FileText size={20}/></span><span>دراسات مالية متاحة<strong>{nf.format(financialStudyCount)}<small>تتضمن بيانات ربعية</small></strong></span></div>
      <div><span className="ed-stat-icon blue"><Layers3 size={20}/></span><span>ملفات استراتيجية<strong>{nf.format(profileCount)}<small>لجهات غير مدرجة</small></strong></span></div>
      <div><span className="ed-stat-icon peach"><BookOpen size={20}/></span><span>أسماء في المرجع الرسمي<strong>{nf.format(listed.length)}<small>هويات، وليست دراسات جاهزة</small></strong></span></div>
    </div>
    <div className="ed-intro"><div><span className="eyebrow">الدراسة تبدأ بمعرفة ما نغطيه</span><h2>الفهرس والدراسات</h2><p>ابدأ بالجهات التي نتابعها، أو ابحث في فهرس الأسماء المدرجة. تظهر حالة كل ملف بوضوح قبل فتحه.</p></div></div>
    <div className="ed-controls"><label className="ed-search"><Search size={19}/><span className="sr-only">ابحث في الفهرس باسم الجهة أو رمز التداول</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث باسم الجهة أو رمز التداول…"/>{query && <button onClick={() => setQuery('')} aria-label="مسح البحث"><X size={16}/></button>}</label><div className="ed-filters" role="group" aria-label="نوع الجهات">{([{ id: 'all', label: 'الكل' }, { id: 'listed', label: 'مدرجة' }, { id: 'strategic', label: 'مشاريع وشركات خاصة' }] as const).map(item => <button key={item.id} className={filter === item.id ? 'active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div></div>
    {directory.sourceLanguage === 'en' && <p className="ed-search-note">تُحفظ أسماء تداول كما نُشرت بالإنجليزية، مع مرادفات عربية مختارة لتسهيل البحث.</p>}<div className="ed-list-heading"><span><ListFilter size={15}/>{searching ? 'نتائج البحث في الفهرس' : expanded ? 'المتابعة والفهرس المرجعي' : 'ملفات المتابعة'}<strong>{nf.format(found.length)}</strong></span>{!searching && <button onClick={() => setExpanded(value => !value)}>{expanded ? 'العودة إلى ملفات المتابعة' : `عرض بقية الفهرس · ${nf.format(referenceOnlyCount)} اسم`}<ArrowLeft size={14}/></button>}</div>
    {!found.length ? <div className="ed-no-results"><Search size={28}/><h3>لا توجد نتائج مطابقة</h3><p>جرّب رمز التداول أو الاسم الإنجليزي الوارد في مرجع تداول. تتوفر مرادفات بحث عربية مختارة، ولا تمثل ترجمة لجميع أسماء الفهرس.</p><button className="btn secondary" onClick={() => { setQuery(''); setFilter('all'); }}>مسح الفلاتر</button></div> : <div className="ed-grid">{found.slice(0, limit).map(entity => <article className={`ed-card ${entity.group} ${entity.tracked ? 'tracked' : 'reference-only'}`} key={entity.id}><div className="ed-card-top"><span className={`ed-entity-icon ${entity.profile?.id || ''}`}>{entity.group === 'strategic' ? <Layers3 size={23}/> : <Building2 size={23}/>}</span><span className={`ed-availability ${entity.hasStudy ? 'available' : ''}`}>{entity.profile ? 'ملف استراتيجي' : entity.hasStudy ? 'دراسة مالية متاحة' : entity.tracked ? 'ملف متابعة' : 'هوية مفهرسة'}</span></div><h3 dir={entity.tracked ? 'auto' : 'ltr'}>{entity.name}</h3>{entity.sourceName && entity.sourceName !== entity.name && <p className="ed-source-name" dir="ltr">{entity.sourceName}</p>}{entity.englishName && <p className="ed-source-name" dir="ltr">{entity.englishName}</p>}<div className="ed-entity-meta">{entity.group === 'listed' ? <><span className="ed-ticker" dir="ltr">{entity.ticker}</span><span>{marketName(entity.market)}</span></> : <span>{entity.profile?.entityKind === 'project' ? 'مشروع وجهة أعمال' : 'شركة خاصة'} · غير مدرجة</span>}{entity.sector && <span>{entity.sector}</span>}</div><p className="ed-card-description">{entity.profile ? 'قراءة استراتيجية من مصادر موثقة، دون افتراض أرباح ربعية أو رمز تداول.' : entity.hasStudy ? 'دراسة تتضمن بيانات ربعية مسجلة ومراجع؛ راجع حدودها وتاريخ قطعها.' : entity.tracked ? 'الجمع مهيّأ في مكتب البحث؛ لم تُسجل أرقام ربعية معتمدة في هذا الملف بعد.' : 'الهوية مفهرسة؛ الجمع والدراسة التلقائية لم تُهيأ بعد.'}</p><div className="ed-card-bottom">{entity.tracked&&onStartResearch?<div className="ed-study-actions"><button className="ed-start-study" onClick={()=>{const id=entity.profile?.id||entity.study?.researchCompanyId||({'4013':'hmg','2222':'aramco','2010':'sabic','7010':'stc','2280':'almarai','1820':'baan'} as Record<string,string>)[entity.ticker||''];if(id)onStartResearch(id)}}><Sparkles size={14}/>ابدأ الدراسة<ArrowLeft size={15}/></button>{entity.study&&entity.hasStudy?<button className="ed-saved-study" onClick={()=>onOpenStudy(entity.study!)}>عرض الدراسة المحفوظة</button>:entity.profile?<button className="ed-saved-study" onClick={()=>openProfile(entity)}>قراءة الملف المحفوظ</button>:null}</div>:entity.study?<button onClick={()=>onOpenStudy(entity.study!)}>{entity.hasStudy?'فتح الدراسة المالية':'فتح ملف المتابعة'}<ArrowLeft size={16}/></button>:entity.profile?<button onClick={()=>openProfile(entity)}>قراءة الملف الاستراتيجي<ArrowLeft size={16}/></button>:directory.sourceUrl&&isSafeSourceUrl(directory.sourceUrl)?<a href={directory.sourceUrl} target="_blank" rel="noopener noreferrer">مرجع الهوية الرسمي<ExternalLink size={14}/></a>:<span>مرجع الهوية غير متاح</span>}</div></article>)}</div>}
    {found.length > limit && <button className="btn secondary ed-load-more" onClick={() => setLimit(value => value + 48)}>عرض مزيد من الأسماء<span>{nf.format(found.length - limit)} متبقية</span><ChevronDown size={16}/></button>}
    <details className="ed-reference-note"><summary><ShieldCheck size={17}/>عن مرجع الفهرس وحدود التغطية<ChevronDown size={16}/></summary><div><p>{directory.coverage || 'هذا فهرس هويات مرجعي؛ لا يضمن وجود دراسة أو موصل جمع لكل اسم.'}</p><div className="ed-reference-meta"><span>تاريخ قراءة المرجع: <bdi>{directory.asOf || 'غير مذكور'}</bdi></span><span>آخر تحديث للمصدر: {directory.sourceAsOf || 'غير مثبت'}</span>{directory.sourceLanguage === 'en' && <span>أسماء المصدر بالإنجليزية، مع مرادفات بحث عربية مختارة</span>}</div>{directory.sourceUrl && isSafeSourceUrl(directory.sourceUrl) && <a href={directory.sourceUrl} target="_blank" rel="noopener noreferrer">{directory.sourceTitle || 'فتح مرجع تداول الرسمي'}<ExternalLink size={14}/></a>}</div></details>

    {selected?.profile && <section className="ed-profile" id="entity-profile-view" aria-labelledby="ed-profile-title"><header><div><span className="eyebrow">ملف استراتيجي · جهة غير مدرجة</span><h2 id="ed-profile-title">{selected.name}</h2>{selected.englishName && <span className="ed-profile-english" dir="ltr">{selected.englishName}</span>}<p>تاريخ القطع: <bdi>{selected.profile.asOf || 'غير مذكور'}</bdi></p></div><div className="ed-profile-actions"><button className="btn secondary" onClick={() => exportProfile(selected.profile!)}><Download size={15}/>تنزيل TXT</button><button className="btn primary" onClick={() => setPrintProfile(selected.profile!)}><Printer size={15}/>طباعة / PDF</button><button className="ed-close-profile" onClick={() => setSelectedId('')} aria-label="إغلاق الملف"><X size={19}/></button></div></header><div className="ed-profile-scope"><ShieldCheck size={17}/><p>يُعرض هذا الملف كقراءة استراتيجية موثقة. لا يدخل في محرك المقارنات الربعية للشركات المدرجة، ولا يُنسب إليه رمز تداول.</p></div><div className="ed-profile-summary"><span className="eyebrow">الخلاصة</span><p>{selected.profile.summary || selected.profile.coverage || 'لا توجد خلاصة متاحة.'}</p></div><div className="ed-findings">{(selected.profile.findings || []).map((finding, i) => <article key={`${finding.title}-${i}`}><span className={`ed-kind ${finding.kind || 'analysis'}`}>{kindLabels[finding.kind || 'analysis'] || 'قراءة منسوبة للمصدر'}</span><h3>{finding.title}</h3><p>{finding.body}</p><div className="ed-citations">{(finding.sourceIds || finding.citations || []).map(id => { const source = selected.profile?.sources?.find(item => item.id === id); return source && isSafeSourceUrl(source.url) ? <a href={source.url} key={id} target="_blank" rel="noopener noreferrer">[{id}]<ArrowUpLeft size={12}/></a> : <span key={id}>[{id}] · يحتاج مراجعة الإسناد</span>; })}</div></article>)}</div><div className="ed-profile-notes"><section><h3><TriangleAlert size={18}/>حدود البيانات</h3><ul>{(selected.profile.limitations || []).map((item, i) => <li key={i}>{item}</li>)}</ul></section><section><h3><Search size={18}/>ما نتابعه لاحقًا</h3><ul>{(selected.profile.nextWatch || []).map((item, i) => <li key={i}>{item}</li>)}</ul></section></div><section className="ed-profile-sources"><h3><BookOpen size={18}/>المصادر المسجلة</h3>{(selected.profile.sources || []).map(source => <div key={source.id}><span className="ed-source-number">{source.id}</span><div><strong>{source.title || source.id}</strong><p>{source.publishedAt ? `تاريخ النشر: ${source.publishedAt}` : 'تاريخ النشر غير مذكور'}{source.locator ? ` · ${source.locator}` : ''}</p>{source.verification && <small>{source.verification}</small>}</div>{isSafeSourceUrl(source.url) && <a href={source.url} target="_blank" rel="noopener noreferrer">الأصل<ExternalLink size={13}/></a>}</div>)}</section></section>}

    <details className="ed-advanced-roles" id="platform-roles"><summary>أدوار المنصة وتفاصيل التنفيذ<ChevronDown size={16}/></summary><section className="ed-roles" aria-labelledby="ed-roles-title"><div className="ed-intro"><div><span className="eyebrow">أدوار واضحة، ونتيجة قابلة للمراجعة</span><h2 id="ed-roles-title">كيف تعمل المنصة؟</h2><p>خطوات متكاملة تبدأ بتحديد النطاق وتنتهي بمراجعتك للتقرير.</p></div><span className="ed-roles-tag"><Network size={15}/>أدوار المنصة الحالية</span></div><div className="ed-role-grid">{platformRoles.map((role, i) => <article key={role.title}><div><span className={`ed-role-icon role-${i}`}><role.icon size={21}/></span><small>{nf.format(i + 1).padStart(2, '٠')}</small></div><h3>{role.title}</h3><p>{role.description}</p><span className={`ed-role-state ${i === 3 ? 'needs-key' : ''}`}>{i === 3 ? <Sparkles size={12}/> : <Check size={12}/>} {role.state}</span></article>)}</div><div className="ed-role-reality"><ShieldCheck size={19}/><p><strong>هذه أدوار وخطوات داخل المنصة.</strong> الجمع والحساب والتحقق تعمل بالكود الفعلي، والتحليل اللغوي يتطلب نموذجًا مهيّأ واتصالًا ناجحًا. لا توجد حاليًا مجموعة وكلاء LLM مستضافين يعملون مستقلين وبشكل دائم.</p></div></section></details>
    {printProfile && createPortal(<div className="entity-print-report" dir="rtl"><header><span>دراسات · مساحة البحث المالي</span><strong>ملف استراتيجي · جهة غير مدرجة</strong></header><div>{profileText(printProfile)}</div><footer>هذا الملف مبني على المصادر المسجلة وحدودها، ولا يمثل مقارنة أرباح ربعية .</footer></div>, document.body)}
  </section>;
}
