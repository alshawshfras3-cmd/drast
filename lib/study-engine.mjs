/**
 * Deterministic financial comparisons. Values use SAR millions; ratios are %.
 * This module has no network, model, storage, or clock dependencies.
 */
export const NUMERIC_FIELDS = Object.freeze([
  'revenue', 'grossProfit', 'operatingProfit', 'netProfit',
  'operatingCashFlow', 'cash', 'totalDebt',
  'previousYearRevenue', 'previousYearNetProfit',
]);
export const FLOW_FIELDS = Object.freeze([
  'revenue', 'grossProfit', 'operatingProfit', 'netProfit', 'operatingCashFlow',
]);
const CORE_FIELDS = ['revenue', 'grossProfit', 'operatingProfit', 'netProfit', 'operatingCashFlow', 'cash', 'totalDebt'];
const validNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const issue = (level, code, message, path) => ({level, code, message, ...(path ? {path} : {})});
const periodParts = (period) => typeof period === 'string' ? /^(\d{4})-Q([1-4])$/.exec(period) : null;
const periodOrder = (period) => {const p = periodParts(period); return p ? Number(p[1]) * 4 + Number(p[2]) - 1 : Infinity;};
const pendingVerification = (item) => typeof item?.verificationStatus === 'string' && /^(pending(?:_|$)|unverified(?:_|$))/i.test(item.verificationStatus);
const fieldSourceId = (quarter, field) => record(quarter.fieldSources) && Object.hasOwn(quarter.fieldSources, field) ? quarter.fieldSources[field] : quarter.sourceId;

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  const day = value.slice(0, 10);
  const parsed = new Date(day + 'T00:00:00.000Z');
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day ||
    (value.length > 10 && Number.isNaN(Date.parse(value))) ? null : day;
}

export function isSafeSourceUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && Boolean(url.hostname);
  } catch {return false;}
}

/** Returns structured issues; missing financial values are warnings, never zero. */
export function validateStudyInput(study) {
  const errors = [], warnings = [];
  const error = (code, message, path) => errors.push(issue('error', code, message, path));
  const warning = (code, message, path) => warnings.push(issue('warning', code, message, path));
  if (!record(study)) return {valid:false, errors:[issue('error', 'INVALID_STUDY', 'بيانات الدراسة غير صالحة.')], warnings};
  for (const field of ['id', 'company', 'ticker']) {
    if (!text(study[field])) error('REQUIRED_FIELD', `الحقل ${field} مطلوب كنص غير فارغ.`, field);
  }
  if (!Number.isInteger(study.year) || study.year < 1900 || study.year > 2200) error('INVALID_YEAR', 'سنة الدراسة غير صالحة.', 'year');
  const cutoff = dateOnly(study.asOf);
  if (!cutoff) error('INVALID_CUTOFF', 'تاريخ قطع الدراسة مطلوب بصيغة YYYY-MM-DD.', 'asOf');
  if (!Array.isArray(study.sources)) error('INVALID_SOURCES', 'مصادر الدراسة يجب أن تكون قائمة.', 'sources');
  if (!Array.isArray(study.quarters) || study.quarters.length === 0) error('NO_QUARTERS', 'أضف بيانات ربع مالي واحد على الأقل.', 'quarters');
  const sources = Array.isArray(study.sources) ? study.sources : [];
  const quarters = Array.isArray(study.quarters) ? study.quarters : [];
  const ids = new Set();
  sources.forEach((source, index) => {
    const path = `sources[${index}]`;
    if (!record(source)) {error('INVALID_SOURCE', 'سجل المصدر غير صالح.', path); return;}
    if (!text(source.id)) error('SOURCE_ID_REQUIRED', 'معرّف المصدر مطلوب.', `${path}.id`);
    else if (ids.has(source.id)) error('DUPLICATE_SOURCE', `معرّف المصدر مكرر: ${source.id}.`, `${path}.id`);
    else ids.add(source.id);
    if (!text(source.title)) error('SOURCE_TITLE_REQUIRED', 'عنوان المصدر مطلوب.', `${path}.title`);
    if (!isSafeSourceUrl(source.url)) error('UNSAFE_SOURCE_URL', 'رابط المصدر يجب أن يكون HTTP أو HTTPS دون بيانات دخول.', `${path}.url`);
    const published = dateOnly(source.publishedAt);
    if (source.publishedAt === null || source.publishedAt === undefined) warning('SOURCE_DATE_UNKNOWN', 'تاريخ نشر المصدر غير معروف؛ لا يحتسب ضمن تغطية المصادر المؤرخة.', `${path}.publishedAt`);
    else if (!published) error('INVALID_SOURCE_DATE', 'تاريخ نشر المصدر غير صالح.', `${path}.publishedAt`);
    else if (cutoff && published > cutoff) error('SOURCE_AFTER_CUTOFF', 'تاريخ نشر المصدر يأتي بعد تاريخ قطع الدراسة.', `${path}.publishedAt`);
    if (pendingVerification(source)) warning('SOURCE_PENDING_VERIFICATION', 'محتوى المصدر قيد التحقق؛ لا يحتسب ضمن تغطية الأدلة.', path);
  });
  const periods = new Set();
  quarters.forEach((quarter, index) => {
    const path = `quarters[${index}]`;
    if (!record(quarter)) {error('INVALID_QUARTER', 'سجل الربع غير صالح.', path); return;}
    const parts = periodParts(quarter.period);
    if (!parts) error('INVALID_PERIOD', 'الفترة يجب أن تكون مثل 2026-Q1.', `${path}.period`);
    else {
      if (Number(parts[1]) !== study.year) error('YEAR_MISMATCH', 'سنة الربع تختلف عن سنة الدراسة.', `${path}.period`);
      const endDate = `${parts[1]}-${['03-31','06-30','09-30','12-31'][Number(parts[2])-1]}`;
      if (cutoff && endDate > cutoff) error('PERIOD_AFTER_CUTOFF', 'لم تنته الفترة المالية عند تاريخ قطع الدراسة.', `${path}.period`);
      if (periods.has(quarter.period)) error('DUPLICATE_QUARTER', `الفترة مكررة: ${quarter.period}.`, `${path}.period`);
      periods.add(quarter.period);
    }
    if (quarter.unit !== 'SAR_million') error('UNIT_MISMATCH', 'يجب توحيد الأرقام إلى مليون ريال سعودي قبل المقارنة.', `${path}.unit`);
    if (!text(quarter.sourceId) || !ids.has(quarter.sourceId)) error('UNKNOWN_SOURCE', 'مصدر أرقام الربع غير موجود في سجل المصادر.', `${path}.sourceId`);
    for (const field of NUMERIC_FIELDS) {
      const value = quarter[field];
      if (value !== null && value !== undefined && !validNumber(value)) error('INVALID_NUMBER', `قيمة ${field} يجب أن تكون رقمًا محدودًا أو null.`, `${path}.${field}`);
    }
    if (quarter.fieldSources !== undefined && quarter.fieldSources !== null) {
      if (!record(quarter.fieldSources)) error('INVALID_FIELD_SOURCES', 'مراجع الحقول يجب أن تكون خريطة حقول مالية إلى معرّفات مصادر.', `${path}.fieldSources`);
      else for (const [field, sourceId] of Object.entries(quarter.fieldSources)) {
        if (!NUMERIC_FIELDS.includes(field)) error('UNKNOWN_FINANCIAL_FIELD', `الحقل المالي غير معروف: ${field}.`, `${path}.fieldSources.${field}`);
        if (!text(sourceId) || !ids.has(sourceId)) error('UNKNOWN_FIELD_SOURCE', `مصدر الحقل ${field} غير موجود في سجل المصادر.`, `${path}.fieldSources.${field}`);
      }
    }
    if (pendingVerification(quarter)) warning('QUARTER_PENDING_VERIFICATION', `${quarter.period || 'الربع'}: البيانات قيد التحقق من المصدر.`, path);
    const missing = CORE_FIELDS.filter((field) => quarter[field] === null || quarter[field] === undefined);
    if (missing.length) warning('MISSING_FINANCIALS', `${quarter.period || 'الربع'}: بيانات مالية ناقصة (${missing.join('، ')}).`, path);
    if (validNumber(quarter.revenue) && quarter.revenue <= 0) warning('NONPOSITIVE_REVENUE', `${quarter.period}: الإيرادات غير موجبة؛ هوامش الربحية غير قابلة للتفسير المعتاد.`, `${path}.revenue`);
  });
  if (study.findings !== undefined && !Array.isArray(study.findings)) error('INVALID_FINDINGS', 'الاستنتاجات يجب أن تكون قائمة.', 'findings');
  (Array.isArray(study.findings) ? study.findings : []).forEach((finding, index) => {
    const path = `findings[${index}]`;
    if (!record(finding)) {error('INVALID_FINDING', 'سجل الاستنتاج غير صالح.', path); return;}
    if (!['fact', 'management', 'analysis'].includes(finding.kind)) error('INVALID_FINDING_KIND', 'نوع الاستنتاج غير معروف.', `${path}.kind`);
    if (!text(finding.title) || !text(finding.body)) error('EMPTY_FINDING', 'عنوان الاستنتاج ونصه مطلوبان.', path);
    if (!Array.isArray(finding.sourceIds) || finding.sourceIds.length === 0) warning('UNSOURCED_FINDING', 'الاستنتاج يحتاج إلى إحالة إلى مصدر.', `${path}.sourceIds`);
    else finding.sourceIds.forEach((id) => {if (!ids.has(id)) error('UNKNOWN_FINDING_SOURCE', `مرجع الاستنتاج غير موجود: ${id}.`, `${path}.sourceIds`);});
  });
  for (const field of ['limitations', 'nextWatch']) {
    if (study[field] !== undefined && (!Array.isArray(study[field]) || study[field].some((item) => !text(item)))) error('INVALID_TEXT_LIST', `${field} يجب أن يكون قائمة نصوص غير فارغة.`, field);
  }
  return {valid:errors.length === 0, errors, warnings};
}

/** Percentage change; a nonpositive base is deliberately undefined. */
export function percentageChange(current, previous) {
  if (!validNumber(current) || !validNumber(previous) || previous <= 0) return null;
  const result = (current / previous - 1) * 100;
  return validNumber(result) ? result : null;
}
const margin = (profit, revenue) => {
  if (!validNumber(profit) || !validNumber(revenue) || revenue <= 0) return null;
  const result = profit / revenue * 100;
  return validNumber(result) ? result : null;
};

export function analyzeStudy(input) {
  const validation = validateStudyInput(input);
  const study = record(input) ? input : {};
  const checks = [...validation.errors, ...validation.warnings];
  const sources = (Array.isArray(study.sources) ? study.sources : []).filter(record);
  const pendingSources = new Set(sources.filter(pendingVerification).map((s) => s.id));
  const isPendingQuarter = (quarter) => pendingVerification(quarter) || pendingSources.has(quarter.sourceId);
  const isAnalyzableQuarter = (quarter) => validNumber(quarter.revenue) && validNumber(quarter.netProfit) &&
    !isPendingQuarter(quarter) && !pendingSources.has(fieldSourceId(quarter,'revenue')) && !pendingSources.has(fieldSourceId(quarter,'netProfit'));
  const raw = (Array.isArray(study.quarters) ? study.quarters : []).filter(record)
    .map((q) => ({...q, ...Object.fromEntries(NUMERIC_FIELDS.map((field) => [field, validNumber(q[field]) ? q[field] : null]))}))
    .sort((a,b) => periodOrder(a.period) - periodOrder(b.period));
  const negativeBase = (q, field, value) => {
    if (validNumber(value) && value <= 0) checks.push(issue('warning', 'NONPOSITIVE_GROWTH_BASE', `${q.period}: لا تحسب نسبة نمو ${field} لأن قيمة المقارنة صفرية أو سالبة.`));
  };
  const quarters = raw.map((q, index) => {
    const previous = index > 0 && periodOrder(q.period) - periodOrder(raw[index-1].period) === 1 ? raw[index-1] : null;
    negativeBase(q, 'الإيرادات السنوية', q.previousYearRevenue);
    negativeBase(q, 'الأرباح السنوية', q.previousYearNetProfit);
    if (previous) {
      negativeBase(q, 'الإيرادات الربعية', previous.revenue);
      negativeBase(q, 'الأرباح الربعية', previous.netProfit);
    } else if (index > 0) checks.push(issue('warning', 'QUARTER_GAP', `${q.period}: لم تحسب مقارنة ربعية لغياب الربع السابق مباشرة.`));
    return {...q,
      grossMargin:margin(q.grossProfit, q.revenue),
      operatingMargin:margin(q.operatingProfit, q.revenue),
      netMargin:margin(q.netProfit, q.revenue),
      revenueYoY:percentageChange(q.revenue, q.previousYearRevenue),
      netProfitYoY:percentageChange(q.netProfit, q.previousYearNetProfit),
      revenueQoQ:percentageChange(q.revenue, previous?.revenue),
      netProfitQoQ:percentageChange(q.netProfit, previous?.netProfit),
    };
  });
  const analyzable = quarters.filter(isAnalyzableQuarter);
  const latest = analyzable.at(-1);
  const latestPending = quarters.filter((q) => !isAnalyzableQuarter(q)).at(-1);
  const eligibleSources = new Set(sources.filter((s) => text(s.id) && !pendingVerification(s) && isSafeSourceUrl(s.url) && dateOnly(s.publishedAt) && dateOnly(study.asOf) && dateOnly(s.publishedAt) <= dateOnly(study.asOf)).map(s => s.id));
  const supported = quarters.filter((q) => !isPendingQuarter(q) && CORE_FIELDS.some((field) => validNumber(q[field]) && eligibleSources.has(fieldSourceId(q,field)))).length;
  const allCore = quarters.length > 0 && quarters.every((q) => CORE_FIELDS.every((field) => validNumber(q[field])));
  const completeFinancials = validation.valid && allCore && supported === quarters.length;
  if (validation.valid) checks.push(issue('pass', 'STRUCTURE_VALID', 'اجتاز الملف فحوص البنية والفترات والوحدات ومراجع المصادر.'));
  if (!completeFinancials) checks.push(issue('warning', 'PRELIMINARY_STUDY', 'الدراسة مبدئية؛ لا تكتمل قراءة السيولة وجودة الأرباح دون التدفقات النقدية والديون والأرصدة والإيضاحات.'));
  const headline = !validation.valid ? 'تحتاج الدراسة إلى تصحيح البيانات قبل الاعتماد.'
    : !latest ? 'لا توجد بيانات كافية للتحليل.'
    : latest.revenueYoY !== null && latest.netProfitYoY !== null
      ? latest.revenueYoY > 0 && latest.netProfitYoY > 0 ? 'نمو سنوي في الإيرادات والأرباح؛ يلزم فحص جودة الأرباح والسيولة.'
      : latest.revenueYoY > 0 && latest.netProfitYoY < 0 ? 'الإيرادات تنمو والأرباح تتراجع؛ يلزم فحص الهوامش وأسباب التغير.'
      : latest.revenueYoY < 0 && latest.netProfitYoY > 0 ? 'الأرباح تنمو رغم تراجع الإيرادات؛ يلزم فحص مكونات الربح.'
      : latest.revenueYoY < 0 && latest.netProfitYoY < 0 ? 'تراجع سنوي في الإيرادات والأرباح؛ يلزم فحص الأسباب التشغيلية.'
      : 'الأداء السنوي متفاوت؛ راجع المؤشرات وأسباب التغير.'
    : 'المقارنات السنوية غير مكتملة؛ راجع البيانات الناقصة.';
  return {quarters, checks, summary:{quarterCount:quarters.length, sourceCount:sources.length,
    analyzableQuarterCount:analyzable.length, latestPendingPeriod:latestPending?.period ?? null,
    latestPeriod:latest?.period ?? null, revenueGrowth:latest?.revenueYoY ?? null,
    profitGrowth:latest?.netProfitYoY ?? null,
    evidenceCoverage:quarters.length ? supported / quarters.length * 100 : 0,
    completeFinancials}, headline};
}

/**
 * Derives a single quarter from compatible cumulative flow statements.
 * Input: {year, months:3|6|9|12, unit:'SAR_million', basis:'…', ...flows}.
 * `basis` must explicitly identify matching consolidation/restatement bases.
 * Q1 can be derived with previous=null; later spans require their predecessor.
 * Throws a TypeError with `.code` on invalid comparisons. No stock field survives.
 */
export function deriveQuarterFromYtd(current, previous = null) {
  const fail = (code, message) => {const error = new TypeError(message); error.code=code; throw error;};
  const validSpan = (v) => record(v) && Number.isInteger(v.year) && [3,6,9,12].includes(v.months) && v.unit === 'SAR_million' && text(v.basis);
  if (!validSpan(current)) fail('INVALID_YTD', 'الفترة التراكمية تحتاج سنة وأشهرًا ووحدة وأساس مقارنة واضحًا.');
  if (current.months !== 3 && !validSpan(previous)) fail('MISSING_PREVIOUS_YTD', 'استخراج الربع يتطلب الفترة التراكمية السابقة مباشرة.');
  if (current.months === 3 && previous !== null) fail('UNEXPECTED_PREVIOUS_YTD', 'الربع الأول لا يحتاج فترة تراكمية سابقة.');
  if (previous && (current.year !== previous.year || current.months - previous.months !== 3 || current.unit !== previous.unit || current.basis !== previous.basis)) fail('INCOMPATIBLE_YTD', 'الفترتان غير متجاورتين أو تختلفان في السنة أو الوحدة أو أساس المقارنة.');
  for (const statement of [current, previous].filter(Boolean)) {
    for (const field of FLOW_FIELDS) {
      if (statement[field] !== undefined && statement[field] !== null && !validNumber(statement[field])) fail('INVALID_YTD_NUMBER', `قيمة ${field} غير صالحة.`);
    }
    if (statement.type && statement.type !== 'ytd') fail('NOT_YTD', 'الاشتقاق يتطلب بيانات تراكمية، وليس أرقام ربع مستقل.');
  }
  const values = Object.fromEntries(FLOW_FIELDS.map((field) => {
    const value = validNumber(current[field]) && (!previous || validNumber(previous[field]))
      ? current[field] - (previous ? previous[field] : 0) : null;
    if (value !== null && !validNumber(value)) fail('YTD_ARITHMETIC_OVERFLOW', `فرق ${field} خارج النطاق الحسابي.`);
    return [field, value];
  }));
  return {period:`${current.year}-Q${current.months/3}`, unit:current.unit, basis:current.basis,
    ...values, cash:null, totalDebt:null, derived:true,
    derivation:{currentMonths:current.months, previousMonths:previous?.months ?? 0, sourceIds:[current.sourceId, previous?.sourceId].filter(text)}};
}
