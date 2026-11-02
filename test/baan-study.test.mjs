import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeStudy, validateStudyInput } from '../lib/study-engine.mjs';
const study = JSON.parse(await readFile(new URL('../data/baan.json', import.meta.url), 'utf8'));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9);

test('Baan is the listed 1820 entity and its documented quarters pass validation', () => {
  assert.equal(study.ticker, '1820'); assert.equal(study.researchCompanyId, 'baan');
  assert.equal(validateStudyInput(study).valid, true);
  const result = analyzeStudy(study);
  assert.equal(result.summary.latestPeriod, '2026-Q2');
  assert.equal(result.summary.analyzableQuarterCount, 2);
});
test('Baan Q1 flows reconcile to H1 minus standalone Q2 within the same shareholders scope', () => {
  const [q1, q2] = study.quarters;
  close(q1.revenue + q2.revenue, study.interimSummary.revenue);
  close(q1.netProfit + q2.netProfit, study.interimSummary.netProfitAttributableToShareholders);
  close(q1.previousYearNetProfit + q2.previousYearNetProfit, study.interimSummary.previousYearNetProfitAttributableToShareholders);
  assert.equal(q2.previousYearNetProfit, 0.158);
  assert.equal(study.annualBackground.netProfitAttributableToShareholders, -201.814);
  assert.equal(study.annualBackground.netProfitGroup, -201.887);
  assert.ok(study.findings.some(item => item.body.includes('0.132')));
});
test('Baan cumulative cash flow and unverified mirror values never enter standalone quarter inputs', () => {
  const [q1, q2] = study.quarters;
  assert.equal(q1.operatingCashFlow, null); assert.equal(q2.operatingCashFlow, null);
  assert.equal(q1.cash, null); assert.equal(q1.totalDebt, null);
  assert.equal(study.pendingMirrorReview.excludedFromEngineInputs, true);
  assert.equal(study.interimSummary.operatingCashFlow, 31.685);
  close(q2.totalDebt, q2.loansExcludingLeases + q2.leaseLiabilities);
  assert.equal(analyzeStudy(study).summary.completeFinancials, false);
});
