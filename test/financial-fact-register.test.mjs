import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { documentPath } from '../lib/access-policy.mjs';
import { createRepository } from '../lib/repository-core.mjs';
import { reviewedFactAnswer } from '../lib/finance/reviewed-fact-answer.mjs';
import { analyzeStudy } from '../lib/study-engine.mjs';

const owner = 'private-workspace';
const docId = '250b425e-75aa-4e4d-85b7-61a31924dada';
const source = {id:'official', title:'إفصاح تجريبي', url:'https://www.almarai.com/', publishedAt:'2026-10-15'};
const fact = {
  ticker:'2280', metric:'revenue', period:'2026-Q3', scope:'consolidated', basis:'standalone_quarter',
  currency:'SAR', scale:3, rawValue:'1200000', sourceId:source.id, documentId:docId,
  cell:{page:2,table:'قائمة الدخل',row:'الإيرادات',column:'الربع المستقل'},
};
const input = {
  id:'almarai-import', company:'المراعي', ticker:'2280', year:2026, asOf:'2026-11-03',
  financialFactsVersion:1, statementScope:'consolidated', sources:[source], financialFacts:[fact],
  quarters:[{period:'2026-Q3',unit:'SAR_million',sourceId:source.id,revenue:9999}],
};

function setup(overrides = {}) {
  const prefix = 'drast/' + owner + '/records/';
  const bytes = Buffer.from('%PDF-test fixture');
  const path = documentPath(docId, 'pdf');
  const docs = new Map([[prefix + 'documents/' + docId + '.json', {
    id:docId,pathname:path,name:'تقرير تجريبي.pdf',size:bytes.length,ticker:'2280',period:'2026-Q3',pageCount:3,...overrides,
  }]]);
  const saved = new Map();
  const store = {
    read:async key=>docs.get(key) ?? saved.get(key) ?? null,
    write:async (key,value)=>saved.set(key,structuredClone(value)),
    list:async key=>[...saved.keys()].filter(item=>item.startsWith(key)),
    file:async key=>Array.from(docs.values()).some(doc=>doc.pathname===key) ? {statusCode:200,stream:new Response(bytes).body} : null,
  };
  return {repo:createRepository(store, []),saved,bytes,docs};
}

test('review records keep the original cell and bytes, and drive the saved comparison', async () => {
  const {repo,saved,bytes} = setup();
  const study = await repo.saveStudy(owner, {
    ...input,
    financialFacts:[{...fact,documentSha256:'spoof'}, {...fact,metric:'netProfit',rawValue:'-120000'}],
    financialFactReview:{confirmedBy:'spoof'},
  }, true);
  assert.equal(saved.size,1);
  assert.equal(study.financialFactReview.confirmedBy,owner);
  assert.equal(study.financialFacts[0].documentSha256,createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(study.financialFacts[0].cell,fact.cell);
  const [reloaded] = await repo.listStudies(owner);
  const result = analyzeStudy(reloaded);
  assert.equal(result.quarters[0].revenue,1200);
  assert.equal(result.quarters[0].netProfit,-120);
  assert.equal(result.quarters[0].netMargin,-10);
  assert.equal(result.quarters[0].operatingCashFlow,null);
  assert.equal(result.summary.evidenceCoverage,2/7*100);
  const {financialFacts,financialFactsVersion,...legacyOverwrite} = study;
  await assert.rejects(repo.saveStudy(owner,legacyOverwrite),/نسخة مراجعة ثابتة/);
  const corrected = await repo.saveStudy(owner,{...study,financialFacts:[{...fact,rawValue:'1000000'}]},true);
  assert.notEqual(corrected.id,study.id);
  assert.equal((await repo.listStudies(owner)).find(row=>row.id===study.id).quarters[0].revenue,1200);
});

test('approval blocks unconfirmed, incompatible and conflicting cells', async () => {
  const {repo,saved} = setup();
  await assert.rejects(repo.saveStudy(owner,input),/أكد مراجعة/);
  for (const variant of [{currency:'USD'},{scope:'standalone'},{basis:'ytd'},{scale:9},{rawValue:1200000},{ticker:'1120'}]) {
    await assert.rejects(repo.saveStudy(owner,{...input,financialFacts:[{...fact,...variant}]},true));
  }
  await assert.rejects(repo.saveStudy(owner,{...input,financialFacts:[fact,{...fact,rawValue:'7'}]},true),/احسم التعارض/);
  assert.equal(saved.size,0);
});

test('a reviewed cell must belong to the saved file, issuer, period and page', async () => {
  for (const override of [{ticker:'1120'},{period:'2026-Q2'},{pageCount:1},{size:1}]) {
    const {repo,saved} = setup(override);
    await assert.rejects(repo.saveStudy(owner,input,true),/الملف المرفوع|نسخة ملف PDF/);
    assert.equal(saved.size,0);
  }
  const {repo,docs} = setup();
  docs.clear();
  await assert.rejects(repo.saveStudy(owner,input,true),/أرفق ملف PDF/);
});

test('year-over-year comparisons use the same quarter and statement scope from the register', async () => {
  const {repo,docs} = setup();
  const priorId = '450b425e-75aa-4e4d-85b7-61a31924dada';
  const doc = docs.values().next().value;
  docs.set('drast/' + owner + '/records/documents/' + priorId + '.json', {
    ...doc,id:priorId,pathname:documentPath(priorId,'pdf'),period:'2025-Q3',
  });
  const prior = {...source,id:'prior',publishedAt:'2025-10-15'};
  const priorFact = {...fact,documentId:priorId,sourceId:prior.id,period:'2025-Q3',rawValue:'1000000'};
  const reviewed = await repo.saveStudy(owner,{...input,sources:[source,prior],financialFacts:[fact,priorFact]},true);
  const [row] = analyzeStudy(reviewed).quarters;
  assert.ok(Math.abs(row.revenueYoY-20)<1e-10);
  assert.equal(row.fieldSources.previousYearRevenue,prior.id);
  assert.equal(reviewed.quarters.length,1);
});

test('a prior-year standalone quarter can cite the comparative column of the current filing', async () => {
  const {repo} = setup();
  const comparative = {...fact,period:'2025-Q3',documentPeriod:'2026-Q3',rawValue:'1000000',cell:{...fact.cell,column:'July–September 2025'}};
  const reviewed = await repo.saveStudy(owner,{...input,financialFacts:[fact,comparative]},true);
  assert.ok(Math.abs(analyzeStudy(reviewed).quarters[0].revenueYoY-20)<1e-10);
  assert.equal(reviewed.financialFacts[1].documentPeriod,'2026-Q3');
  await assert.rejects(repo.saveStudy(owner,{...input,financialFacts:[fact,{...comparative,period:'2025-Q2'}]},true));
  await assert.rejects(repo.saveStudy(owner,{...input,financialFacts:[fact,{...comparative,metric:'cash',basis:'closing_balance'}]},true));
});

test('Arabic answers use only the persisted reviewed facts and preserve SAR scale and citations', async () => {
  const {repo} = setup();
  const study = await repo.saveStudy(owner, input, true);
  const saved = await repo.readReviewedStudy(owner, study.id);
  const answer = reviewedFactAnswer(saved, 'كم بلغت الإيرادات في آخر ربع؟');
  assert.equal(answer.status, 'answer');
  assert.deepEqual(answer.rows[0], {
    period:'2026-Q3', value:'1200000', unit:'ألف ريال سعودي',
    citation:{documentId:docId, documentName:'تقرير تجريبي.pdf', ...fact.cell},
  });
  const comparison = reviewedFactAnswer(saved, 'الإيرادات في ٢٠٢٦-Q3 مقابل ٢٠٢٥-Q3');
  assert.deepEqual(comparison.rows[1], {period:'2025-Q3'});
  assert.deepEqual(reviewedFactAnswer(saved, 'كم صافي الربح في آخر ربع؟').rows, [{period:'2026-Q3'}]);
  assert.equal(reviewedFactAnswer(saved, 'لماذا ارتفعت الإيرادات في آخر ربع؟').status, 'clarify');
  assert.equal(reviewedFactAnswer(input, 'كم الإيرادات في آخر ربع؟').status, 'unreviewed');
  assert.equal(await repo.readReviewedStudy(owner, 'almarai-import'), null);
  await assert.rejects(repo.readReviewedStudy('other', study.id), /مساحة غير مصرح بها/);
});
