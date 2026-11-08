import { createHash } from 'node:crypto';
import { documentPath } from '../access-policy.mjs';

// Only statement URLs with a confirmed filing period enter the review library.
const periods = new Map([
  ['https://almmedia.almarai.com/FinancialReports/English-FS--Q31012202654628AM.pdf','2026-Q3'],
  ['https://www.stc.com/content/dam/groupsites/en/pdf/financial-statementsQ2-2026En.pdf','2026-Q2'],
]);

export function collectedPdfRecord(company, source, bytes, approvedIssuers) {
  const period = periods.get(source.url);
  if (!period || !company.ticker || source.kind !== 'pdf' || !approvedIssuers.has(company.id) ||
      !Number.isInteger(source.totalPages) || source.totalPages < 1 || source.totalPages > 300) return null;
  const hash = createHash('sha256').update(company.ticker + ':' + period + ':').update(bytes).digest('hex');
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
  return {
    id, pathname:documentPath(id,'pdf'), name:`${company.name} — ${period}.pdf`,
    company:company.name, ticker:company.ticker, period, pageCount:source.totalPages, text:source.text,
  };
}
