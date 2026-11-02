import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { getDocumentProxy } from 'unpdf';
import { getPilotCompany } from './pilot-catalog.mjs';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 30_000;
const MAX_TOTAL_TEXT = 60_000;
const MAX_PAGES = 48;
const MAX_SOURCES = 3;
const TIMEOUT_MS = 10_000;
const TOTAL_BUDGET_MS = 45_000;

class SourceError extends Error {}

export function validateSourceUrl(input, company) {
  let url;
  try { url = new URL(input); } catch { throw new SourceError('رابط المصدر غير صالح.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !company.hosts.includes(url.hostname)) {
    throw new SourceError('حُجب رابط خارج النطاقات الرسمية المسموح بها للشركة.');
  }
  url.hash = '';
  return url.href;
}

function cleanText(value) {
  return value.replace(/\u0000/g, '').replace(/[\t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function readLimited(response, maxBytes, signal) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new SourceError('تجاوز المستند حد التنزيل الآمن (8 ميغابايت كحد أقصى).');
  }
  if (!response.body) throw new SourceError('لم يُرجع المصدر محتوى قابلاً للقراءة.');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw new SourceError('انتهت مهلة قراءة المصدر.');
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new SourceError('تجاوز المستند حد التنزيل الآمن (8 ميغابايت كحد أقصى).');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function download(url, company, options) {
  let current = validateSourceUrl(url, company);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    for (let redirects = 0; redirects <= 2; redirects += 1) {
      const response = await options.fetchImpl(current, {
        redirect: 'manual', signal: controller.signal,
        headers: { 'User-Agent': 'DrastResearchPilot/0.1 (public company investor reports)', Accept: 'text/html,application/pdf;q=0.9' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 2) throw new SourceError('تعذر اتباع تحويلات المصدر ضمن الحد المسموح.');
        current = validateSourceUrl(new URL(location, current).href, company);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new SourceError(`تعذر جلب المصدر (HTTP ${response.status}).`);
      }
      const contentType = response.headers.get('content-type') ?? '';
      const bytes = await readLimited(response, options.maxBytes, controller.signal);
      const isPdf = new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
      if (!isPdf && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        throw new SourceError('نوع المستند غير مدعوم؛ تُقرأ صفحات HTML وملفات PDF النصية فقط.');
      }
      return { url: current, bytes, isPdf };
    }
    throw new SourceError('تعذر جلب المصدر.');
  } catch (error) {
    if (controller.signal.aborted) throw new SourceError('انتهت مهلة الاتصال بالمصدر؛ يمكن إعادة المحاولة لاحقًا.');
    throw error;
  } finally { clearTimeout(timer); }
}

function discoveryScore(title, url, currentYear, knownSource = false) {
  const value = `${title} ${decodeURIComponent(url)}`.toLowerCase();
  if ((!knownSource && !/\.pdf(?:\?|$)/i.test(url)) || !/financial|statement|interim|earning|investor|presentation|results|تقرير|نتائج|قوائم|قائم|financialreports/i.test(value)) return -1;
  if (/privacy|cookie|policy|sustainab|governance|remuneration|board|prospectus|إستدامة|حوكمة/i.test(value)) return -1;
  const years = [...value.matchAll(/20[12]\d/g)].map(match => Number(match[0]));
  const year = Math.max(0, ...years.filter(item => item <= currentYear));
  if (years.some(item => item > currentYear)) return -1;
  const q = Number(value.match(/(?:q|quarter[ -]?)([1-4])/i)?.[1] ?? 0);
  const half = value.includes('h1') ? 2 : value.includes('h2') ? 4 : 0;
  return (year || currentYear - 5) * 100 + Math.max(q, half) * 10 + (/financial|statement|interim|قوائم/.test(value) ? 5 : 0);
}

function parseHtml(bytes, url, company, options) {
  const $ = load(new TextDecoder().decode(bytes));
  const title = cleanText($('h1').first().text() || $('title').text() || company.name).slice(0, 220);
  const candidates = [];
  $('a[href]').each((_i, element) => {
    try {
      const candidate = validateSourceUrl(new URL($(element).attr('href'), url).href, company);
      const score = discoveryScore($(element).text(), candidate, options.currentYear);
      if (score >= 0) candidates.push({ url: candidate, score });
    } catch { /* Off-domain links are not collection candidates. */ }
  });
  $('script,style,noscript,nav,header,footer,form,svg,iframe,[role="navigation"],[aria-hidden="true"],.cookie-banner,.cookie-consent').remove();
  $('br, p, li, tr, h1, h2, h3, h4, article, section, div').each((_i, element) => { $(element).append('\n'); });
  const main = $('main').first();
  const article = $('article').first();
  const rawText = (main.length ? main : article.length ? article : $('body')).text();
  const templateCount = (rawText.match(/\{\{[^}]*\}\}/g) ?? []).length;
  const text = cleanText(rawText.replace(/\{\{[^}]*\}\}/g, ''));
  const templateOnly = templateCount >= 2 && !/(?:revenue|profit|SAR|إيرادات|صافي|مليون)\s*[:(]?\s*[\d٠-٩]/i.test(text);
  return { title, text: text.slice(0, options.maxText), templateOnly, truncated: text.length > options.maxText, candidates: candidates.sort((a, b) => b.score - a.score) };
}

async function parsePdf(bytes, company, options) {
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  const totalPages = pdf.numPages;
  let text = '';
  let pagesRead = 0;
  let truncated = false;
  try {
    const started = Date.now();
    for (let pageNumber = 1; pageNumber <= Math.min(totalPages, options.maxPages); pageNumber += 1) {
      if (Date.now() - started > options.pdfTimeoutMs) { truncated = true; break; }
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const line = cleanText(content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join(''));
        const pageText = `[صفحة ${pageNumber}]\n${line}\n\n`;
        const remaining = options.maxText - text.length;
        if (remaining <= 0) { truncated = true; break; }
        text += pageText.slice(0, remaining);
        pagesRead += 1;
        if (pageText.length > remaining) { truncated = true; break; }
      } finally { page.cleanup(); }
    }
    return { title: `مستند مالي رسمي — ${company.name}`, text: text.trim(), pagesRead, totalPages, truncated: truncated || pagesRead < totalPages };
  } finally { await pdf.loadingTask.destroy(); }
}

function evidenceFingerprint(evidence) {
  return createHash('sha256').update(JSON.stringify(evidence.map(item => ({ url: item.url, text: item.text })).sort((a, b) => a.url.localeCompare(b.url)))).digest('hex');
}

/** Only catalogued company IDs enter this boundary. No URL from a client is fetched. */
export async function collectCompanySources(companyId, suppliedOptions = {}) {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const company = getPilotCompany(companyId);
  if (!company) throw new SourceError('الشركة غير موجودة في قائمة التجربة.');
  const options = {
    fetchImpl: suppliedOptions.fetchImpl ?? fetch,
    timeoutMs: Math.min(suppliedOptions.timeoutMs ?? TIMEOUT_MS, TIMEOUT_MS),
    maxBytes: Math.min(suppliedOptions.maxBytes ?? MAX_BYTES, MAX_BYTES),
    maxText: Math.min(suppliedOptions.maxText ?? MAX_TEXT, MAX_TEXT),
    maxPages: Math.min(suppliedOptions.maxPages ?? MAX_PAGES, MAX_PAGES),
    pdfTimeoutMs: 12_000,
    currentYear: new Date().getUTCFullYear(),
    now: suppliedOptions.now ?? (() => new Date().toISOString()),
  };
  const issues = [company.coverageNote, 'فُحصت مصادر محدودة من علاقات المستثمرين؛ هذه ليست تغطية شاملة للأخبار أو تحققًا محاسبيًا.'];
  const evidence = [];
  const visited = new Set();
  let pending = company.sourceUrls.map(url => ({ url, score: discoveryScore(company.sourceHints?.[url] ?? '', url, options.currentYear, true) }));
  let totalText = 0;
  for (let attempt = 0; attempt < MAX_SOURCES && pending.length; attempt += 1) {
    if (deadline - Date.now() < 1_500) {
      issues.push('انتهت الميزانية الزمنية للجمع؛ بقيت مصادر لم تُفحص ويمكن إعادة المحاولة لاحقًا.');
      break;
    }
    const source = pending.shift();
    if (visited.has(source.url)) { attempt -= 1; continue; }
    visited.add(source.url);
    try {
      const stepOptions = { ...options, timeoutMs: Math.min(options.timeoutMs, deadline - Date.now()) };
      const document = await download(source.url, company, stepOptions);
      if (deadline - Date.now() < 1_000) {
        issues.push(`لم يبق وقت كافٍ لقراءة المستند بعد تنزيله: ${source.url}`);
        break;
      }
      stepOptions.pdfTimeoutMs = Math.min(options.pdfTimeoutMs, deadline - Date.now() - 500);
      const result = document.isPdf ? await parsePdf(document.bytes, company, stepOptions) : parseHtml(document.bytes, document.url, company, options);
      if (!document.isPdf && result.candidates.length) {
        const discovered = result.candidates.filter(item => !visited.has(item.url));
        const fallback = pending.filter(item => !discovered.some(candidate => candidate.url === item.url));
        pending = [...discovered, ...fallback].sort((a, b) => b.score - a.score);
      }
      const substantiveText = result.text.replace(/\[صفحة \d+\]/g, '').trim();
      if (result.templateOnly || substantiveText.length < 140 || /access denied|request rejected|verify you are human|just a moment|checking your browser/i.test(substantiveText.slice(0, 800))) {
        issues.push(`لم تتوفر قراءة نصية كافية من ${document.url}؛ قد يكون المحتوى ديناميكيًا أو ممسوحًا ضوئيًا أو محجوبًا. لم يُنفذ OCR.`);
        continue;
      }
      const remaining = MAX_TOTAL_TEXT - totalText;
      const text = result.text.slice(0, remaining);
      const truncated = result.truncated || text.length < result.text.length;
      totalText += text.length;
      evidence.push({
        id: `${company.id}-${createHash('sha256').update(document.url + '\n' + text).digest('hex').slice(0, 14)}`,
        companyId: company.id, title: result.title, url: document.url, text, checkedAt: options.now(),
        kind: document.isPdf ? 'pdf' : 'html', truncated,
        ...(document.isPdf ? { pagesRead: result.pagesRead, totalPages: result.totalPages } : {}),
      });
      if (truncated) issues.push(`قراءة جزئية للمستند ${document.url}${document.isPdf ? ` (${result.pagesRead} من ${result.totalPages} صفحة)` : ''}؛ قد يكون النص داخل الصفحة الأخيرة مقتطعًا، ولا يُفترض اكتمال القوائم.`);
      if (remaining <= result.text.length) break;
    } catch (error) {
      const reason = error instanceof SourceError ? error.message : 'تعذر تنزيل المستند أو استخراج نصه في هذه المحاولة.';
      issues.push(`${reason} المصدر: ${source.url}`);
    }
  }
  if (!evidence.length) issues.push('لم تُجمع أدلة نصية؛ لا يمكن إصدار دراسة مستندة إلى المصادر في هذه المحاولة.');
  return { companyId: company.id, evidence, issues, fingerprint: evidenceFingerprint(evidence) };
}
