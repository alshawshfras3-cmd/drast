const labels = {
  revenue:'الإيرادات',
  grossProfit:'إجمالي الربح',
  operatingProfit:'الربح التشغيلي',
  netProfit:'صافي الربح العائد للمساهمين',
  operatingCashFlow:'التدفق النقدي التشغيلي',
  cash:'النقد وما في حكمه',
  totalDebt:'إجمالي الديون',
};
const units = {0:'ريال سعودي',3:'ألف ريال سعودي',6:'مليون ريال سعودي'};

function normalize(text) {
  return text.trim().replace(/[أإآ]/g, 'ا').replace(/[ً-ْـ]/g, '')
    .replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15))
    .replace(/[؟?]+$/, '').replace(/\s+/g, ' ').trim();
}

const metrics = new Map(Object.entries(labels).map(([key,label]) => [normalize(label), key]));
metrics.set('صافي الربح', 'netProfit');

export function reviewedFactAnswer(study, question) {
  if (study?.financialFactsVersion !== 1 || !study.financialFactReview || !study.financialFacts?.length) {
    return {status:'unreviewed', message:'تحتاج هذه الدراسة إلى سجل أرقام مراجع قبل طرح الأسئلة.'};
  }
  const facts = study.financialFacts;
  const periods = [...new Set(facts.map(fact => fact.period))].sort().reverse();
  const match = /^(?:كم (?:بلغت? )?)?(.+?) (?:في )?(اخر ربع|\d{4}-Q[1-4])(?: مقابل (\d{4}-Q[1-4]))?$/i.exec(normalize(question));
  const metric = match && metrics.get(match[1]);
  if (!metric) {
    return {status:'clarify', message:'اكتب اسم مؤشر واحد وفترته. مثال: كم الإيرادات في آخر ربع؟ أو الإيرادات في 2026-Q3 مقابل 2025-Q3. تعرض المحادثة القيم ومراجعها؛ تفسير الأسباب يحتاج أدلة إضافية.', periods};
  }
  const requested = [...new Set([match[2], match[3]].filter(Boolean).map(period =>
    period === 'اخر ربع' ? periods[0] : period.toUpperCase()))];
  const rows = requested.map(period => {
    const fact = facts.find(item => item.metric === metric && item.period === period);
    if (!fact || fact.currency !== 'SAR' || !Object.hasOwn(units, fact.scale)) return {period};
    return {
      period, value:fact.rawValue, unit:units[fact.scale],
      citation:{documentId:fact.documentId, documentName:fact.documentName, ...fact.cell},
    };
  });
  return {
    status:'answer', metric:labels[metric], rows,
    scope:study.statementScope === 'consolidated' ? 'القوائم الموحدة' : 'القوائم المستقلة',
  };
}
