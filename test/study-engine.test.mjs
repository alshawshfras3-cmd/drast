import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeStudy, validateStudyInput, percentageChange, deriveQuarterFromYtd, isSafeSourceUrl} from '../lib/study-engine.mjs';

const source = {id:'s1', title:'إعلان نتائج', url:'https://www.saudiexchange.sa/results', publishedAt:'2026-10-25', documentType:'results'};
const quarter = (n, values={}) => ({period:`2026-Q${n}`, revenue:100, grossProfit:30, operatingProfit:20, netProfit:15, operatingCashFlow:12, cash:40, totalDebt:50, previousYearRevenue:80, previousYearNetProfit:10, sourceId:'s1', unit:'SAR_million', ...values});
const study = (quarters=[quarter(1)]) => ({id:'test', company:'شركة اختبار', ticker:'1234', year:2026, asOf:'2026-11-02', sources:[{...source}], quarters, findings:[], limitations:[], nextWatch:[]});

test('sorts periods and computes comparable growth/margins without mutating input', () => {
  const input=study([quarter(3,{revenue:150,netProfit:30}), quarter(1), quarter(2,{revenue:120,netProfit:24})]);
  const before=JSON.stringify(input), result=analyzeStudy(input);
  assert.deepEqual(result.quarters.map(q=>q.period), ['2026-Q1','2026-Q2','2026-Q3']);
  assert.equal(result.quarters[2].revenueQoQ,25);
  assert.equal(result.quarters[2].netProfitQoQ,25);
  assert.equal(result.quarters[0].grossMargin,30);
  assert.equal(result.quarters[0].revenueQoQ,null);
  assert.equal(result.summary.evidenceCoverage,100);
  assert.equal(result.summary.completeFinancials,true);
  assert.equal(JSON.stringify(input),before);
});

test('missing values remain unknown, never zero and prevent completeness', () => {
  const result=analyzeStudy(study([quarter(1,{operatingCashFlow:null,totalDebt:null,previousYearNetProfit:null})]));
  assert.equal(result.quarters[0].operatingCashFlow,null);
  assert.equal(result.quarters[0].netProfitYoY,null);
  assert.equal(result.summary.completeFinancials,false);
  assert.ok(result.checks.some(c=>c.code==='MISSING_FINANCIALS'));
});

test('zero/negative comparison bases are undefined and flagged', () => {
  assert.equal(percentageChange(10,0),null);
  assert.equal(percentageChange(10,-5),null);
  const result=analyzeStudy(study([quarter(1,{previousYearNetProfit:-10,previousYearRevenue:0})]));
  assert.equal(result.quarters[0].netProfitYoY,null);
  assert.equal(result.quarters[0].revenueYoY,null);
  assert.equal(result.checks.filter(c=>c.code==='NONPOSITIVE_GROWTH_BASE').length,2);
});

test('extreme finite inputs cannot leak Infinity into derived ratios', () => {
  assert.equal(percentageChange(1e308,1e-308),null);
  const result=analyzeStudy(study([quarter(1,{revenue:1e-308,netProfit:1e308})]));
  assert.equal(result.quarters[0].netMargin,null);
});

test('nonadjacent quarters cannot become quarter-on-quarter comparisons', () => {
  const result=analyzeStudy(study([quarter(1),quarter(3)]));
  assert.equal(result.quarters[1].revenueQoQ,null);
  assert.ok(result.checks.some(c=>c.code==='QUARTER_GAP'));
});

test('rejects duplicate periods, invalid units, missing references and numeric strings', () => {
  const result=validateStudyInput(study([quarter(1),quarter(1,{unit:'SAR',sourceId:'absent',revenue:'100'})]));
  for (const code of ['DUPLICATE_QUARTER','UNIT_MISMATCH','UNKNOWN_SOURCE','INVALID_NUMBER']) assert.ok(result.errors.some(c=>c.code===code));
  assert.equal(result.valid,false);
});

test('rejects unsafe links, impossible dates and sources published after cutoff', () => {
  assert.equal(isSafeSourceUrl('javascript:alert(1)'),false);
  assert.equal(isSafeSourceUrl('https://user:secret@example.com'),false);
  const input=study(); input.sources[0].publishedAt='2026-11-03';
  assert.ok(validateStudyInput(input).errors.some(c=>c.code==='SOURCE_AFTER_CUTOFF'));
  input.sources[0].publishedAt='2026-02-30';
  assert.ok(validateStudyInput(input).errors.some(c=>c.code==='INVALID_SOURCE_DATE'));
  input.sources[0].publishedAt='2026-11-02Tinvalid';
  assert.ok(validateStudyInput(input).errors.some(c=>c.code==='INVALID_SOURCE_DATE'));
  input.sources[0].url='data:text/html,test';
  assert.ok(validateStudyInput(input).errors.some(c=>c.code==='UNSAFE_SOURCE_URL'));
});

test('future-published evidence is not counted in coverage', () => {
  const input=study(); input.sources[0].publishedAt='2026-11-03';
  const result=analyzeStudy(input);
  assert.equal(result.summary.evidenceCoverage,0);
  assert.equal(result.summary.completeFinancials,false);
});

test('an additional undated source warns without invalidating an otherwise valid study', () => {
  const input=study();
  input.sources.push({...source,id:'annual',publishedAt:null});
  const validation=validateStudyInput(input);
  assert.equal(validation.valid,true);
  assert.ok(validation.warnings.some(c=>c.code==='SOURCE_DATE_UNKNOWN'));
  const result=analyzeStudy(input);
  assert.equal(result.summary.evidenceCoverage,100);
  assert.equal(result.summary.completeFinancials,true);
  input.quarters[0].sourceId='annual';
  assert.equal(analyzeStudy(input).summary.evidenceCoverage,0);
  assert.equal(analyzeStudy(input).summary.completeFinancials,false);
});

test('missing source publication dates warn while explicit invalid dates remain errors', () => {
  const input=study(); delete input.sources[0].publishedAt;
  assert.equal(validateStudyInput(input).valid,true);
  input.sources[0].publishedAt='';
  assert.ok(validateStudyInput(input).errors.some(c=>c.code==='INVALID_SOURCE_DATE'));
});

test('financial quarters ending after the cutoff cannot be reported as completed periods', () => {
  const input=study([quarter(4)]);
  assert.ok(validateStudyInput(input).errors.some(c=>c.code==='PERIOD_AFTER_CUTOFF'));
  input.asOf='2026-12-31';
  assert.equal(validateStudyInput(input).valid,true);
});

test('an empty pending quarter does not replace the latest analyzable quarter or inflate evidence coverage', () => {
  const input=study([quarter(1),quarter(2,{revenue:150,netProfit:25}),quarter(3,Object.fromEntries([
    'revenue','grossProfit','operatingProfit','netProfit','operatingCashFlow','cash','totalDebt','previousYearRevenue','previousYearNetProfit'
  ].map(field=>[field,null])))]);
  input.sources.push({...source,id:'s3',verificationStatus:'pending'});
  input.quarters[2].sourceId='s3';
  input.quarters[2].verificationStatus='pending_primary_source';
  const result=analyzeStudy(input);
  assert.equal(result.summary.quarterCount,3);
  assert.equal(result.summary.analyzableQuarterCount,2);
  assert.equal(result.summary.latestPeriod,'2026-Q2');
  assert.equal(result.summary.latestPendingPeriod,'2026-Q3');
  assert.equal(result.summary.revenueGrowth,percentageChange(150,80));
  assert.equal(result.summary.profitGrowth,150);
  assert.ok(Math.abs(result.summary.evidenceCoverage-200/3)<1e-10);
  assert.match(result.headline,/نمو سنوي/);
});

test('a blank row without a pending marker is neither analyzable nor supported evidence', () => {
  const blank=quarter(2,Object.fromEntries(['revenue','grossProfit','operatingProfit','netProfit','operatingCashFlow','cash','totalDebt'].map(field=>[field,null])));
  const result=analyzeStudy(study([quarter(1),blank]));
  assert.equal(result.summary.latestPeriod,'2026-Q1');
  assert.equal(result.summary.latestPendingPeriod,'2026-Q2');
  assert.equal(result.summary.evidenceCoverage,50);
});

test('pending sources cannot support even populated rows or supply headline metrics', () => {
  const input=study([quarter(1),quarter(2)]);
  input.sources.push({...source,id:'pending',verificationStatus:'pending_primary_source'});
  input.quarters[1].sourceId='pending';
  const result=analyzeStudy(input);
  assert.equal(result.summary.analyzableQuarterCount,1);
  assert.equal(result.summary.latestPeriod,'2026-Q1');
  assert.equal(result.summary.evidenceCoverage,50);
});

test('field sources must reference known sources and known financial fields', () => {
  const input=study();
  input.sources.push({...source,id:'cashflows'});
  input.quarters[0].fieldSources={cash:'cashflows',operatingCashFlow:'cashflows'};
  assert.equal(validateStudyInput(input).valid,true);
  input.quarters[0].fieldSources.cash='missing';
  assert.ok(validateStudyInput(input).errors.some(c=>c.code==='UNKNOWN_FIELD_SOURCE'));
  input.quarters[0].fieldSources.typo='cashflows';
  assert.ok(validateStudyInput(input).errors.some(c=>c.code==='UNKNOWN_FINANCIAL_FIELD'));
  input.quarters[0].fieldSources=[];
  assert.ok(validateStudyInput(input).errors.some(c=>c.code==='INVALID_FIELD_SOURCES'));
});

test('field-level evidence cannot fall back to a different source when its explicit source is pending', () => {
  const input=study([quarter(1,Object.fromEntries(['grossProfit','operatingProfit','netProfit','operatingCashFlow','cash','totalDebt'].map(field=>[field,null])))]);
  input.sources.push({...source,id:'pending',verificationStatus:'pending'});
  input.quarters[0].fieldSources={revenue:'pending'};
  const result=analyzeStudy(input);
  assert.equal(result.summary.evidenceCoverage,0);
});

test('negative revenue is a warning rather than a schema error', () => {
  const result=validateStudyInput(study([quarter(1,{revenue:-100})]));
  assert.equal(result.valid,true);
  assert.ok(result.warnings.some(c=>c.code==='NONPOSITIVE_REVENUE'));
});

test('profits greater than revenue are not automatically rejected', () => {
  assert.equal(validateStudyInput(study([quarter(1,{netProfit:200})])).valid,true);
});

test('findings must reference actual sources; false numerical values are rejected', () => {
  const input=study([quarter(1,{cash:Infinity,totalDebt:false})]);
  input.findings=[{kind:'analysis',title:'قراءة',body:'ملاحظة',sourceIds:['bad']}];
  const result=validateStudyInput(input);
  assert.equal(result.errors.filter(c=>c.code==='INVALID_NUMBER').length,2);
  assert.ok(result.errors.some(c=>c.code==='UNKNOWN_FINDING_SOURCE'));
});

test('malformed input returns useful errors instead of throwing', () => {
  for (const value of [null,[],{}, {sources:[null],quarters:[null]}]) {
    const result=analyzeStudy(value);
    assert.ok(result.checks.some(c=>c.level==='error'));
    assert.equal(result.summary.completeFinancials,false);
  }
});

const ytd = (months, values={}) => ({year:2026,months,unit:'SAR_million',basis:'consolidated-restated-v1',revenue:months*100,grossProfit:months*30,operatingProfit:months*20,netProfit:months*15,operatingCashFlow:months*10,cash:999,totalDebt:888,type:'ytd',sourceId:`y${months}`, ...values});

test('derives Q2 and Q4 flow values while never subtracting balance-sheet stocks', () => {
  const q2=deriveQuarterFromYtd(ytd(6),ytd(3));
  assert.equal(q2.period,'2026-Q2'); assert.equal(q2.revenue,300);
  assert.equal(q2.operatingCashFlow,30); assert.equal(q2.cash,null); assert.equal(q2.totalDebt,null);
  const q4=deriveQuarterFromYtd(ytd(12),ytd(9));
  assert.equal(q4.period,'2026-Q4'); assert.equal(q4.netProfit,45);
  assert.deepEqual(q4.derivation.sourceIds,['y12','y9']);
});

test('Q1 preserves flows and missing values stay unknown in differences', () => {
  assert.equal(deriveQuarterFromYtd(ytd(3)).revenue,300);
  const q=deriveQuarterFromYtd(ytd(9,{operatingCashFlow:null}),ytd(6));
  assert.equal(q.operatingCashFlow,null);
  assert.throws(()=>deriveQuarterFromYtd(ytd(3),ytd(3)),{code:'UNEXPECTED_PREVIOUS_YTD'});
});

test('refuses incompatible YTD periods, years, units, restatements and standalone quarters', () => {
  for (const [current,previous] of [
    [ytd(9),ytd(3)], [ytd(6),ytd(3,{year:2025})],
    [ytd(6),ytd(3,{basis:'different'})],
    [ytd(6,{type:'quarter'}),ytd(3)], [ytd(6,{revenue:'100'}),ytd(3)],
    [ytd(6,{unit:'SAR'}),ytd(3)], [ytd(6,{basis:''}),ytd(3)],
  ]) assert.throws(()=>deriveQuarterFromYtd(current,previous));
  assert.throws(()=>deriveQuarterFromYtd(ytd(12)),{code:'MISSING_PREVIOUS_YTD'});
});
