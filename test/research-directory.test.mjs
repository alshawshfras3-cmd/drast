import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = async name => JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));

test('listed directory preserves unique sourced identities without pretending to contain market prices', async () => {
  const directory = await read('listed-directory');
  assert.equal(directory.completeness, 'source_snapshot_not_live_directory');
  assert.equal(directory.companies.length, 376);
  assert.equal(new Set(directory.companies.map(c => c.ticker)).size, 376);
  assert.equal(directory.companies.filter(c => c.market === 'main').length, 253);
  assert.equal(directory.companies.filter(c => c.market === 'nomu').length, 123);
  for (const company of directory.companies) {
    assert.match(company.ticker, /^\d{4}$/); assert.ok(company.name.trim());
    assert.equal(company.price, undefined); assert.equal(company.revenue, undefined);
  }
  assert.ok(directory.companies.find(c => c.ticker === '1120').searchAliases.includes('مصرف الراجحي'));
});
test('strategic studies retain references and do not enter the quarterly listed-company engine', async () => {
  for (const id of ['kafd', 'humain']) {
    const profile = await read(`${id}-profile`);
    assert.equal(profile.id, id); assert.equal(profile.ticker, null);
    assert.equal(profile.quarters, undefined); assert.equal(profile.netProfit, undefined);
    assert.ok(profile.limitations.length > 0);
    const sources = new Set(profile.sources.map(source => source.id));
    for (const finding of profile.findings) {
      assert.ok(finding.sourceIds.length > 0);
      finding.sourceIds.forEach(sourceId => assert.ok(sources.has(sourceId)));
    }
  }
});


test('directory search finds major issuers by Arabic alias, English name and Arabic ticker', async () => {
  const {companyMatches, exactCompanyMatch} = await import('../lib/directory-search.mjs');
  const {companies} = await read('listed-directory');
  for (const [name,ticker] of [['الراجحي','1120'], ['الأهلي','1180'], ['الإنماء','1150'], ['معادن','1211'], ['أكوا باور','2082']]) {
    assert.ok(companies.some(company => company.ticker === ticker && companyMatches(company,name)));
  }
  assert.deepEqual(companies.filter(company => exactCompanyMatch(company,'١١٢٠')).map(company => company.ticker),['1120']);
  assert.deepEqual(companies.filter(company => exactCompanyMatch(company,'۱۱۲۰')).map(company => company.ticker),['1120']);
  assert.ok(companies.some(company => company.ticker === '1120' && companyMatches(company,'Al Rajhi Bank')));
});
