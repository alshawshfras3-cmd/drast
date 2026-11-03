export const FINANCIAL_FACT_METRICS = Object.freeze([
  'revenue', 'grossProfit', 'operatingProfit', 'netProfit', 'operatingCashFlow', 'cash', 'totalDebt',
]);

const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const documentId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const quarterPattern = /^(\d{4})-Q([1-4])$/;
const scales = [0, 3, 6];
const balances = new Set(['cash', 'totalDebt']);

function normalizeFact(input, scope, ticker, year, sources) {
  const fact = record(input) ? input : {};
  const cell = record(fact.cell) ? fact.cell : {};
  const period = typeof fact.period === 'string' && quarterPattern.exec(fact.period);
  const source = sources.get(fact.sourceId);
  if (!FINANCIAL_FACT_METRICS.includes(fact.metric) || fact.ticker !== ticker ||
      !period || ![year, year - 1].includes(Number(period[1])) || fact.scope !== scope ||
      fact.basis !== (balances.has(fact.metric) ? 'closing_balance' : 'standalone_quarter')) {
    throw Error('تحقق من الشركة والمؤشر والفترة ونطاق القوائم. يلزم ربع مستقل للتدفقات ورصيد نهاية الربع للأرصدة.');
  }
  if (fact.currency !== 'SAR' || !scales.includes(fact.scale) || typeof fact.rawValue !== 'string' ||
      !/^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,9})?$/.test(fact.rawValue) ||
      fact.rawValue.replace(/[-.]/g, '').replace(/^0+/, '').length > 15) {
    throw Error('أدخل القيمة الأصلية كسلسلة عشرية بالريال السعودي، وحدد المقياس 0 أو 3 أو 6.');
  }
  const endDate = period[1] + '-' + ['03-31', '06-30', '09-30', '12-31'][Number(period[2]) - 1];
  if (!source || typeof source.publishedAt !== 'string' || source.publishedAt.slice(0, 10) < endDate || /pending|unverified/i.test(String(source.verificationStatus || '')) ||
      typeof fact.documentId !== 'string' || !documentId.test(fact.documentId) ||
      !Number.isInteger(cell.page) || cell.page < 1 || cell.page > 300 ||
      !text(cell.table, 160) || !text(cell.row, 160) || !text(cell.column, 160)) {
    throw Error('يلزم مصدر مؤرخ وملف مرفوع وموضع محدد للصفحة والجدول والصف والعمود.');
  }
  return {
    ticker, metric:fact.metric, period:fact.period, scope, basis:fact.basis,
    currency:'SAR', scale:fact.scale, rawValue:fact.rawValue, sourceId:fact.sourceId, documentId:fact.documentId,
    cell:{page:cell.page, table:cell.table.trim(), row:cell.row.trim(), column:cell.column.trim()},
  };
}

export function normalizeFinancialFacts(study) {
  const scope = study.statementScope;
  if (study.financialFactsVersion !== 1 || !['consolidated','standalone'].includes(scope) ||
      typeof study.ticker !== 'string' || !/^\d{4,6}$/.test(study.ticker) ||
      !Number.isInteger(study.year) || study.year < 1901 || study.year > 2200 ||
      !Array.isArray(study.financialFacts) || !study.financialFacts.length || study.financialFacts.length > 56) {
    throw Error('سجل الحقائق يحتاج إصدارًا صالحًا ونطاق قوائم واحدًا ومن حقيقة إلى 56 حقيقة.');
  }
  const sources = new Map(study.sources.filter(record).map(source => [source.id, source]));
  const facts = new Map();
  const documentsBySource = new Map();
  for (const input of study.financialFacts) {
    const fact = normalizeFact(input, scope, study.ticker, study.year, sources);
    const key = fact.period + ':' + fact.metric;
    if (facts.has(key)) throw Error('يوجد أكثر من رقم للمؤشر والفترة نفسها. احسم التعارض قبل الاعتماد.');
    const existingDocument = documentsBySource.get(fact.sourceId);
    if (existingDocument && existingDocument !== fact.documentId) throw Error('اربط كل مصدر بنسخة مستند واحدة.');
    documentsBySource.set(fact.sourceId, fact.documentId);
    facts.set(key, fact);
  }
  if (!Array.from(facts.values()).some(fact => fact.period.startsWith(study.year + '-'))) {
    throw Error('أضف حقائق من سنة الدراسة الحالية.');
  }
  if (new Set(documentsBySource.values()).size > 8) throw Error('الحد الأقصى ثمانية ملفات في سجل الدراسة.');
  return [...facts.values()];
}

export function quartersFromFacts(facts, year) {
  const periods = new Map();
  for (const fact of facts) {
    const row = periods.get(fact.period) ?? {period:fact.period, unit:'SAR_million', sourceId:fact.sourceId, fieldSources:{}};
    // The decimal string stays exact in the register. The legacy study engine
    // takes numbers in SAR millions. The amount contract bounds precision.
    row[fact.metric] = Number(fact.rawValue + 'e' + (fact.scale - 6));
    row.fieldSources[fact.metric] = fact.sourceId;
    periods.set(fact.period, row);
  }
  return [...periods.values()].filter(row => row.period.startsWith(year + '-')).map(row => {
    const prior = periods.get((year - 1) + row.period.slice(4));
    if (prior) {
      for (const [metric, field] of [['revenue','previousYearRevenue'], ['netProfit','previousYearNetProfit']]) {
        if (Object.hasOwn(prior, metric)) {
          row[field] = prior[metric];
          row.fieldSources[field] = prior.fieldSources[metric];
        }
      }
    }
    return row;
  }).sort((a,b) => a.period.localeCompare(b.period));
}
