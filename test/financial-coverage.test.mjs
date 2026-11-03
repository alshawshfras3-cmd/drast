import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStudy } from '../lib/study-engine.mjs';

test('a pending cash flow source cannot complete the coverage of a populated quarter', () => {
  const source = {id:'dated',title:'قائمة مالية',url:'https://example.com/report.pdf',publishedAt:'2026-04-20'};
  const cashFlowSource = {...source,id:'cashflow',verificationStatus:'pending_review'};
  const input = {
    id:'coverage-regression',company:'المراعي',ticker:'2280',year:2026,asOf:'2026-11-03',
    sources:[source,cashFlowSource],
    quarters:[{period:'2026-Q1',unit:'SAR_million',sourceId:source.id,fieldSources:{operatingCashFlow:cashFlowSource.id},
      revenue:100,grossProfit:30,operatingProfit:20,netProfit:10,operatingCashFlow:0,cash:20,totalDebt:30}],
  };
  const pending = analyzeStudy(input).summary;
  assert.equal(pending.completeFinancials,false);
  assert.equal(pending.evidenceCoverage,6/7*100);
  cashFlowSource.verificationStatus = 'verified';
  const verified = analyzeStudy(input).summary;
  assert.equal(verified.evidenceCoverage,100);
  assert.equal(verified.completeFinancials,true);
});
