'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

export type ReviewDocument = {
  id: string;
  name: string;
  company?: string;
  ticker?: string;
  period?: string;
  pageCount?: number;
};

const metrics = {
  revenue: 'الإيرادات',
  grossProfit: 'إجمالي الربح',
  operatingProfit: 'الربح التشغيلي',
  netProfit: 'صافي الربح العائد لملاك الشركة الأم',
  operatingCashFlow: 'التدفق النقدي التشغيلي',
  cash: 'النقد وما في حكمه',
  totalDebt: 'إجمالي الدين',
};

type Metric = keyof typeof metrics;
type Scope = '' | 'consolidated' | 'standalone';
type ReviewRow = {
  id: number;
  metric: string;
  period: string;
  rawValue: string;
  scale: string;
  currency: '' | 'SAR';
  origin: 'text' | 'ocr' | 'manual';
  scope: Scope;
  page: string;
  table: string;
  row: string;
  column: string;
};

const asOf = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const scopes = { consolidated: 'موحدة', standalone: 'مستقلة' };
const balanceMetric = (metric: string) => metric === 'cash' || metric === 'totalDebt';
const scopeFrom = (scope: unknown): Scope => scope === 'consolidated' || scope === 'standalone' ? scope : '';

export default function FinancialReview({
  document, onClose, onSaved,
}: {
  document: ReviewDocument;
  onClose: () => void;
  onSaved: (study: { id: string }) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const extraction = useRef<AbortController | null>(null);
  const previewRequest = useRef<AbortController | null>(null);
  const previewObject = useRef('');
  const nextId = useRef(0);
  const saving = useRef(false);
  const documentPeriod = document.period || '';
  const period = /^(\d{4})-Q([1-4])$/.exec(documentPeriod);
  const year = period ? Number(period[1]) : 0;
  const previousPeriod = period ? (year - 1) + '-Q' + period[2] : '';
  const pageCount = Number(document.pageCount) || 0;
  const usable = Boolean(period && /^\d{4,6}$/.test(document.ticker || '') && document.company?.trim() && Number.isInteger(pageCount) && pageCount > 0 && pageCount <= 300);
  const documentUrl = '/api/documents?id=' + encodeURIComponent(document.id) + '&download=true';

  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [scope, setScope] = useState<Scope>('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [publishedAt, setPublishedAt] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'idle' | 'extracting' | 'saving'>('idle');

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      extraction.current?.abort();
      previewRequest.current?.abort();
      if (previewObject.current) URL.revokeObjectURL(previewObject.current);
      element?.close();
    };
  }, []);

  function editRow(id: number, changes: Partial<ReviewRow>) {
    setConfirmed(false);
    setRows(previous => previous.map(row => row.id === id ? { ...row, ...changes } : row));
  }

  function addRow() {
    setConfirmed(false);
    const id = nextId.current++;
    setRows(previous => [...previous, {
      id, metric: '', period: documentPeriod, rawValue: '', scale: '', currency: '', origin: 'manual', scope,
      page: '', table: '', row: '', column: '',
    }]);
  }

  async function extract() {
    if (extraction.current || saving.current || !usable || rows.length) return;
    const controller = new AbortController();
    extraction.current = controller;
    setPhase('extracting');
    setError('');
    setWarnings([]);
    setConfirmed(false);
    try {
      const { extractFinancialCandidates } = await import('@/lib/finance/pdf-candidates');
      const result = await extractFinancialCandidates(documentUrl, documentPeriod, controller.signal);
      if (controller.signal.aborted) return;
      const candidates = result.rows.slice(0, 56).map(candidate => ({
        id: nextId.current++,
        metric: candidate.metric, period: candidate.period, rawValue: candidate.rawValue,
        scale: candidate.scale == null ? '' : String(candidate.scale), currency: candidate.currency === 'SAR' ? 'SAR' as const : '' as const, origin: candidate.source, scope: scopeFrom(candidate.scope),
        page: String(candidate.page), table: candidate.table, row: candidate.row, column: candidate.column,
      }));
      const detectedScopes = new Set(candidates.map(candidate => candidate.scope));
      setScope(detectedScopes.size === 1 ? candidates[0].scope : '');
      setRows(candidates);
      setWarnings(result.warnings);
    } catch {
      if (!controller.signal.aborted) setError('تعذّر استخراج القيم من التقرير. يمكنك إدخالها يدويًا من النسخة الأصلية.');
    } finally {
      extraction.current = null;
      if (!controller.signal.aborted) setPhase('idle');
    }
  }

  async function preparePreview() {
    if (previewRequest.current || previewObject.current) return;
    const controller = new AbortController();
    previewRequest.current = controller;
    setPreviewLoading(true);
    setError('');
    try {
      const response = await fetch(documentUrl, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      if (blob.size > 15 * 1024 * 1024 || await blob.slice(0, 5).text() !== '%PDF-') throw new Error();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      previewObject.current = url;
      setPreviewUrl(url);
    } catch {
      if (!controller.signal.aborted) setError('تعذّرت معاينة صفحات الملف. نزّل النسخة الأصلية لمراجعتها.');
    } finally {
      previewRequest.current = null;
      if (!controller.signal.aborted) setPreviewLoading(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || extraction.current || !usable || !rows.length || !confirmed || !scope) return;
    setError('');
    const keys = new Set(rows.map(row => row.period + ':' + row.metric));
    if (keys.size !== rows.length) {
      setError('تكرر مؤشر في الفترة نفسها. راجع القيم المتعارضة واحذف التكرار قبل الاعتماد.');
      return;
    }
    if (rows.some(row => row.scope !== scope)) {
      setError('اختر نطاق القوائم المطابق لكل خلية. اعتمد مجموعة من القوائم الموحدة أو المستقلة في دراسة واحدة.');
      return;
    }
    if (rows.some(row => row.currency !== 'SAR' || !['0', '3', '6'].includes(row.scale))) {
      setError('تحقق من أن القيم بالريال السعودي وحدد المقياس لكل خلية.');
      return;
    }
    if (!rows.some(row => row.period === documentPeriod)) {
      setError('أضف قيمة واحدة على الأقل للربع الحالي.');
      return;
    }
    const sourceId = 'financial-statement';
    saving.current = true;
    setPhase('saving');
    try {
      const response = await fetch('/api/studies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmFinancialFacts: true,
          study: {
            id: 'review-' + document.id,
            company: document.company,
            ticker: document.ticker,
            year,
            asOf: asOf(),
            financialFactsVersion: 1,
            statementScope: scope,
            sources: [{ id: sourceId, title: document.name, url: sourceUrl.trim(), publishedAt }],
            financialFacts: rows.map(row => ({
              ticker: document.ticker, metric: row.metric, period: row.period, documentPeriod,
              scope: row.scope, basis: balanceMetric(row.metric) ? 'closing_balance' : 'standalone_quarter',
              currency: row.currency, scale: Number(row.scale), rawValue: row.rawValue.trim(),
              sourceId, documentId: document.id,
              cell: { page: Number(row.page), table: row.table.trim(), row: row.row.trim(), column: row.column.trim() },
            })),
          },
        }),
      });
      const payload = await response.json() as { error?: string; study?: { id?: unknown } };
      if (!response.ok || !payload.study || typeof payload.study.id !== 'string' || !payload.study.id) {
        throw new Error(payload.error || 'لم تؤكّد المنصة حفظ الدراسة.');
      }
      onSaved(payload.study as { id: string });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر حفظ الدراسة.');
    } finally {
      saving.current = false;
      setPhase('idle');
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal financial-review"
      aria-labelledby="financial-review-title"
      onCancel={event => { event.preventDefault(); if (!saving.current) onClose(); }}
      style={{ width: 'min(960px, calc(100% - 24px))', margin: 'auto' }}
    >
      <header className="modal-heading">
        <div>
          <p>{document.company} · <bdi>{document.ticker}</bdi> · <bdi>{documentPeriod}</bdi></p>
          <h2 id="financial-review-title">مراجعة الأرقام المالية</h2>
        </div>
        <button type="button" className="btn secondary" disabled={phase === 'saving'} onClick={onClose}>إغلاق</button>
      </header>
      <p className="muted">{document.name} · <a href={documentUrl}>تنزيل التقرير الأصلي</a></p>
      {usable && (
        <div className="financial-review-source">
          {previewUrl ? <a href={previewUrl} target="_blank" rel="noopener noreferrer">فتح الأصل في تبويب جديد</a> :
            <button type="button" className="btn secondary" disabled={previewLoading} onClick={preparePreview}>
              {previewLoading ? 'جارٍ تحميل صفحات الأصل…' : 'إتاحة معاينة صفحات الأصل'}
            </button>}
        </div>
      )}
      {!usable && <p className="form-error" role="alert">يلزم مستند محفوظ باسم شركة ورمز تداول وفترة ربعية وعدد صفحات صحيح. تحقق من بيانات الملف وأعد رفعه عند الحاجة.</p>}
      <form onSubmit={save}>
        <fieldset disabled={!usable || phase !== 'idle'}>
          <div className="form-grid">
            <label>رابط الإفصاح الرسمي
              <input dir="ltr" type="url" required pattern="https://.+" maxLength={2048} value={sourceUrl} onChange={event => { setSourceUrl(event.target.value); setConfirmed(false); }} placeholder="https://…" />
            </label>
            <label>تاريخ النشر
              <input type="date" required min={period ? year + '-' + ['03-31', '06-30', '09-30', '12-31'][Number(period[2]) - 1] : undefined} max={asOf()} value={publishedAt} onChange={event => { setPublishedAt(event.target.value); setConfirmed(false); }} />
            </label>
            <label>نطاق القوائم
              <select required value={scope} onChange={event => { setScope(scopeFrom(event.target.value)); setConfirmed(false); }}>
                <option value="">حدد النطاق</option>
                {Object.entries(scopes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn secondary" disabled={rows.length > 0} onClick={extract}>استخراج القيم المقترحة</button>
            <button type="button" className="btn secondary" disabled={rows.length >= 56} onClick={addRow}>إضافة قيمة يدويًا</button>
          </div>
          {!rows.length && <p className="muted">استخرج القيم المقترحة أو أضف قيمة من التقرير لمراجعتها.</p>}
          {rows.length > 0 && <p className="muted">{rows.length} قيمة للمراجعة. افحص الرقم ووحدته والربع والعمود قبل الاعتماد.</p>}
          {rows.map((row, index) => (
            <fieldset key={row.id} className="financial-review-row">
              <legend>{metrics[row.metric as Metric] || 'قيمة'} · {index + 1} · {row.origin === 'ocr' ? 'قراءة بصرية' : row.origin === 'text' ? 'نص المستند' : 'إدخال يدوي'}</legend>
              <div className="form-grid">
                <label>المؤشر
                  <select required value={row.metric} onChange={event => editRow(row.id, { metric: event.target.value, ...(balanceMetric(event.target.value) ? { period: documentPeriod } : {}) })}>
                    <option value="">اختر مؤشرًا</option>
                    {Object.entries(metrics).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label>الفترة
                  <select required value={row.period} onChange={event => editRow(row.id, { period: event.target.value })}>
                    <option value={documentPeriod}>{documentPeriod}</option>
                    {!balanceMetric(row.metric) && previousPeriod && <option value={previousPeriod}>{previousPeriod}</option>}
                  </select>
                </label>
                <label>القيمة الأصلية
                  <input required dir="ltr" inputMode="decimal" maxLength={26} pattern={String.raw`-?(0|[1-9]\d{0,14})(\.\d{1,9})?`} value={row.rawValue} onChange={event => editRow(row.id, { rawValue: event.target.value })} />
                </label>
                <label>العملة
                  <select required value={row.currency} onChange={event => editRow(row.id, { currency: event.target.value === 'SAR' ? 'SAR' : '' })}>
                    <option value="">تحقق من العملة</option>
                    <option value="SAR">ريال سعودي</option>
                  </select>
                </label>
                <label>مقياس الرقم
                  <select required value={row.scale} onChange={event => editRow(row.id, { scale: event.target.value })}>
                    <option value="">اختر وحدة</option>
                    <option value="0">ريال</option><option value="3">ألف ريال</option><option value="6">مليون ريال</option>
                  </select>
                </label>
                <label>نطاق الخلية
                  <select required value={row.scope} onChange={event => editRow(row.id, { scope: scopeFrom(event.target.value) })}>
                    <option value="">حدد النطاق</option>
                    {Object.entries(scopes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label>صفحة PDF
                  <input type="number" required min={1} max={pageCount} value={row.page} onChange={event => editRow(row.id, { page: event.target.value })} />
                </label>
                <label>الجدول
                  <input required maxLength={160} value={row.table} onChange={event => editRow(row.id, { table: event.target.value })} />
                </label>
                <label>الصف
                  <input required maxLength={160} value={row.row} onChange={event => editRow(row.id, { row: event.target.value })} />
                </label>
                <label>العمود
                  <input required maxLength={160} value={row.column} onChange={event => editRow(row.id, { column: event.target.value })} />
                </label>
              </div>
              {previewUrl && Number(row.page) >= 1 && Number(row.page) <= pageCount && (
                <a href={previewUrl + '#page=' + Number(row.page)} target="_blank" rel="noopener noreferrer">فتح صفحة الدليل {row.page}</a>
              )}
              <button type="button" className="btn secondary" aria-label={'حذف القيمة ' + (index + 1)} onClick={() => { setConfirmed(false); setRows(previous => previous.filter(item => item.id !== row.id)); }}>حذف القيمة</button>
            </fieldset>
          ))}
          {rows.length > 0 && (
            <label className="financial-review-confirm">
              <input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
              راجعت الخلايا في المستند الأصلي وتحققت من القيم والفترات والنطاق والوحدة بالريال السعودي.
            </label>
          )}
        </fieldset>
        {phase === 'extracting' && <p className="progress" role="status">جارٍ قراءة صفحات التقرير في المتصفح…</p>}
        {warnings.length > 0 && <ul className="muted" aria-label="ملاحظات الاستخراج">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="submit" className="btn primary" disabled={!usable || !confirmed || !rows.length || phase !== 'idle'}>
            {phase === 'saving' ? 'جارٍ الحفظ…' : 'اعتماد الأرقام وحفظ الدراسة'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
