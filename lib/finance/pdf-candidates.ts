import type { Worker } from 'tesseract.js';
import { candidateContext, parseFinancialPage, parseOcrTsv } from './candidate-parser.mjs';

export type FinancialCandidate = {
  metric: string;
  period: string;
  rawValue: string;
  scale: 0 | 3 | 6 | null;
  scope: 'consolidated' | 'standalone' | null;
  currency: 'SAR' | null;
  page: number;
  source: 'text' | 'ocr';
  table: string;
  row: string;
  column: string;
};

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 12;
const OCR_PAGES = 8;
const OCR_PIXELS = 9_000_000;
const MAX_EMBEDDED_IMAGE_PIXELS = 40_000_000;

async function downloadPdf(path: string, signal: AbortSignal) {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || url.pathname !== '/api/documents' || url.searchParams.get('download') !== 'true') {
    throw new Error('اختر ملف PDF من مكتبة المستندات.');
  }
  const response = await fetch(url, { signal, credentials: 'same-origin', redirect: 'error' });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('تعذّر تحميل ملف PDF أو تجاوز الحجم المسموح.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error('تجاوز حجم ملف PDF الحد المسموح.');
      }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-') throw new Error('المستند المحدد ليس ملف PDF صالحًا.');
  return data;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function openOcrWorker(signal: AbortSignal) {
  signal.throwIfAborted();
  const { createWorker, PSM } = await import('tesseract.js');
  const origin = window.location.origin;
  let onFailure: (reason: unknown) => void;
  const failure = new Promise<never>((_, reject) => { onFailure = reject; });
  const pending = createWorker('eng', 1, {
    workerPath: origin + '/ocr/worker.min.js',
    corePath: origin + '/ocr/core',
    langPath: origin + '/ocr/lang',
    workerBlobURL: false,
    errorHandler: error => onFailure(error),
  });
  let worker: Worker;
  try {
    worker = await abortable(Promise.race([pending, failure]), signal);
  } catch (error) {
    void pending.then(late => late.terminate()).catch(() => {});
    throw error;
  }
  try {
    signal.throwIfAborted();
    await abortable(worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK }), signal);
    signal.throwIfAborted();
    return worker;
  } catch (error) {
    await worker.terminate();
    throw error;
  }
}

export async function extractFinancialCandidates(path: string, documentPeriod: string, signal?: AbortSignal) {
  if (!/^\d{4}-Q[1-4]$/.test(documentPeriod)) {
    throw new Error('قراءة الجداول تدعم إفصاح ربع بصيغة السنة والربع، مثل 2026-Q3.');
  }
  const timeout = AbortSignal.timeout(120_000);
  const active = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const data = await downloadPdf(path, active);
  const pdfjs = await import('pdfjs-dist');
  active.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data, disableFontFace: true, maxImageSize: MAX_EMBEDDED_IMAGE_PIXELS, canvasMaxAreaInBytes: OCR_PIXELS * 4 });
  let worker: Worker | undefined;
  const abort = () => {
    void worker?.terminate().catch(() => {});
    void task.destroy().catch(() => {});
  };
  active.addEventListener('abort', abort, { once: true });
  let rows: FinancialCandidate[] = [];
  const warnings: string[] = [];
  try {
    const pdf = await task.promise;
    type Page = Awaited<ReturnType<typeof pdf.getPage>>;
    const scanned: Page[] = [];
    const incomePagesNeedingOcr: Page[] = [];
    const textPages = [];
    const pages = Math.min(pdf.numPages, MAX_PAGES);
    if (pdf.numPages > pages) warnings.push('اقتصر البحث على أول 12 صفحة من المستند.');
    for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
      active.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const words = content.items.flatMap(item => {
        if (!('str' in item) || !item.str.trim()) return [];
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const height = Math.abs(item.height);
        return [...item.str.matchAll(/\S+/g)].map(match => ({
          text: match[0],
          left: (x + item.width * match.index / item.str.length) / viewport.width,
          right: (x + item.width * (match.index + match[0].length) / item.str.length) / viewport.width,
          y: (y-height*0.45) / viewport.height,
        }));
      });
      const text = content.items.map(item => 'str' in item ? item.str : '').join(' ');
      if (text.replace(/\s/g, '').length < 100) scanned.push(page);
      textPages.push({ pageNumber, page, words, text });
    }
    const context = candidateContext(textPages.map(item => item.text).join(' '));
    for (const { pageNumber, page, words, text } of textPages) {
      const parsed = parseFinancialPage(words, { documentPeriod, page: pageNumber, source: 'text', context }) as FinancialCandidate[];
      rows.push(...parsed);
      // Some PDFs include a broken text overlay on top of an image table.
      if (parsed.length < 8 && /statement of (?:profit\s+or\s+loss|income)|income statement|قائمة (?:الدخل|الربح أو الخسارة)/iu.test(text)) {
        incomePagesNeedingOcr.push(page);
      }
    }
    const ocrQueue = [...new Set([...incomePagesNeedingOcr, ...scanned])];
    if (ocrQueue.length > OCR_PAGES) warnings.push('اقتصر التعرف البصري على أول ثماني صفحات مصوّرة ضمن النطاق.');
    // Skip OCR when a complete current and comparative income table already exists.
    if (ocrQueue.length && rows.length < 8) {
      try {
        worker = await openOcrWorker(active);
        for (const page of ocrQueue.slice(0, OCR_PAGES)) {
          active.throwIfAborted();
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(4.16, Math.sqrt(OCR_PIXELS/(base.width*base.height))) });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const context2d = canvas.getContext('2d', { willReadFrequently: true });
          if (!context2d) continue;
          const render = page.render({ canvas, canvasContext: context2d, viewport });
          const cancelRender = () => render.cancel();
          active.addEventListener('abort', cancelRender, { once: true });
          try {
            await render.promise;
            const { data } = await abortable(worker.recognize(canvas, {}, { tsv: true, text: false }), active);
            active.throwIfAborted();
            const words = parseOcrTsv(data.tsv ?? '', canvas.width, canvas.height);
            rows.push(...parseFinancialPage(words, { documentPeriod, page: page.pageNumber, source: 'ocr', context }) as FinancialCandidate[]);
          } finally {
            active.removeEventListener('abort', cancelRender);
            canvas.width = 0;
            canvas.height = 0;
          }
          if (rows.length >= 8) break;
        }
      } catch (error) {
        if (active.aborted) throw active.reason;
        warnings.push('تعذّر تشغيل التعرف البصري. استخدم القيم المتاحة أو أكمل المراجعة يدويًا.');
      }
    }
    active.throwIfAborted();
    const unique = new Map<string, FinancialCandidate>();
    const conflicts = new Set<string>();
    for (const row of rows) {
      const key = row.metric + ':' + row.period;
      const prior = unique.get(key);
      if (prior && (row.rawValue !== prior.rawValue || row.scale !== prior.scale || row.scope !== prior.scope || row.currency !== prior.currency)) {
        conflicts.add(key);
      }
      if (!prior) unique.set(key, row);
    }
    if (conflicts.size) warnings.push('استبعدت قيَمًا متعارضة لنفس المؤشر والفترة.');
    rows = [...unique].filter(([key]) => !conflicts.has(key)).map(([, row]) => row);
    if (!rows.length) warnings.push('لم نجد أعمدة أرباع مستقلة يمكن اقتراحها من الصفحات المفحوصة. راجع الملف وأدخل الأرقام يدويًا.');
    return { rows, warnings };
  } finally {
    active.removeEventListener('abort', abort);
    await worker?.terminate().catch(() => {});
    await task.destroy().catch(() => {});
  }
}
