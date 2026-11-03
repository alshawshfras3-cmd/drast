import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../app/pilot-browser-store.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  .replace('@/lib/research-issuers.mjs', new URL('../lib/research-issuers.mjs', import.meta.url).href);
const { parseResearchBackup } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const sample = () => ({ id: 'job-1', companyIds: ['aramco'], question: 'سؤال', type: 'results', status: 'paused', createdAt: '2026-11-02T09:00:00Z', updatedAt: '2026-11-02T09:00:00Z', day: '2026-11-02', evidence: [], issues: [], collectedCompanyIds: [] });
test('single report exports and complete backups restore without losing manual text', () => {
  const job = { ...sample(), editedText: 'ملاحظاتي الأصلية', editedAt: '2026-11-02T10:00:00Z' };
  for (const payload of [{ schemaVersion: 1, job }, { schemaVersion: 1, jobs: [job] }]) assert.equal(parseResearchBackup(payload, ['aramco'])[0].editedText, 'ملاحظاتي الأصلية');
});
test('invalid optional dates, unsafe source URLs and duplicate records are rejected before writing', () => {
  const invalidDate = { ...sample(), completedAt: 'invalid' };
  const unsafe = { ...sample(), evidence: [{ id: 'e1', companyId: 'aramco', title: 'title', text: 'text', url: 'javascript:alert(1)', kind: 'html', checkedAt: '2026-11-02' }] };
  for (const jobs of [[invalidDate], [unsafe], [sample(), sample()]]) assert.throws(() => parseResearchBackup({ schemaVersion: 1, jobs }, ['aramco']));
});
test('an interrupted task resumes and an unavailable duplicate target is rechecked', () => {
  for (const status of ['collecting', 'drafting', 'no_change']) {
    const restored = parseResearchBackup({ schemaVersion: 1, jobs: [{ ...sample(), status, duplicateOf: 'missing' }] }, ['aramco'])[0];
    assert.equal(restored.status, 'paused'); assert.equal(restored.duplicateOf, undefined);
  }
});

