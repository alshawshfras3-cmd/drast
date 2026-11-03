import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchPrompt, validateResearchReport } from '../lib/research-contract.mjs';

const sourceSentence = 'Consolidated revenue was SAR 22,064,876 thousand for the year ended 31 December 2025.';
const evidence = [{
  id:'almarai-fy2025', companyId:'almarai', title:'قوائم المراعي',
  url:'https://www.almarai.com/en/corporate/investors/financial-reports-information',
  kind:'pdf', checkedAt:'2026-11-03T00:00:00Z', text:'[صفحة 158]\n' + sourceSentence,
}];
const section = {title:'الإيرادات', body:'يوضح المقتطف إيرادات القوائم الموحدة.', kind:'fact', sourceIds:[evidence[0].id]};
const draft = {title:'المراعي', summary:'مسودة للمراجعة', sections:[section], limitations:[], nextWatch:[]};
const validate = (overrides = {}, sources = evidence) => validateResearchReport({...draft, ...overrides}, sources);

test('known Almarai value cannot be rewritten as a different currency, scale, period or concept', () => {
  for (const body of [
    'بلغت إيرادات المراعي 22,064,876 ألف دولار أمريكي.',
    'بلغت إيرادات المراعي 22,064,876 مليون ريال.',
    'بلغت إيرادات المراعي في 2023 مقدار 22,064,876 ألف ريال.',
    'بلغ صافي ربح المراعي 22,064,876 ألف ريال.',
    'بلغ الإيراد ٢٢٬٠٦٤٬٨٧٦ ألف ريال.',
  ]) {
    assert.throws(() => validate({sections:[{...section,body}]}), {code:'UNSUPPORTED_FINANCIAL_NUMBER'});
  }
  assert.throws(() => validate({summary:'بلغت الإيرادات 22,064,876 ألف دولار.'}), {code:'UNSUPPORTED_FINANCIAL_NUMBER'});
});

test('prompt offers the complete source sentence and validation renders it without alteration', () => {
  const ref = evidence[0].id + ':1';
  assert.ok(buildResearchPrompt({companyIds:['almarai'],evidence}).includes(ref));
  const report = validate({sections:[{...section,quoteRefs:[ref]}]});
  assert.match(report.sections[0].body, /صفحة 158/);
  assert.ok(report.sections[0].body.endsWith('«' + sourceSentence + '»'));
  assert.deepEqual(report.sections[0].sourceIds, [evidence[0].id]);
});

test('uncited, fabricated and truncated quote references cannot render', () => {
  const other = {...evidence[0], id:'other-document'};
  assert.throws(() => validate({sections:[{...section,quoteRefs:['other-document:1']}]}, [...evidence,other]), {code:'INVALID_EVIDENCE_QUOTE'});
  assert.throws(() => validate({sections:[{...section,quoteRefs:['almarai-fy2025:2']}]}), {code:'INVALID_EVIDENCE_QUOTE'});
  assert.throws(() => validate({sections:[{...section,quoteRefs:['almarai-fy2025:1']}]}, [{...evidence[0],text:evidence[0].text.slice(0,-1)}]), {code:'INVALID_EVIDENCE_QUOTE'});
});
