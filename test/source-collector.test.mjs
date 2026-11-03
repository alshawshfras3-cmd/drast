import test from 'node:test';
import assert from 'node:assert/strict';
import { collectedPdfRecord } from '../lib/finance/collected-pdf.mjs';
import { collectCompanySources, validateSourceUrl } from '../lib/source-collector.mjs';
import { getPilotCompany, isAllowedCompanySourceUrl, PILOT_COMPANIES } from '../lib/pilot-catalog.mjs';

const reportHtml = '<html><head><title>Financial results</title></head><body><nav>BAD NAVIGATION</nav><main><h1>Financial results Q3 2026</h1><p>' + 'Revenue and profit are disclosed in this company financial results announcement. '.repeat(5) + '</p></main><script>BAD SCRIPT</script></body></html>';
const htmlResponse = html => new Response(html, { headers: { 'content-type': 'text/html' } });

function pdfFixture() {
  const parts = ['%PDF-1.4\n'];
  const offsets = [0];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = `BT /F1 12 Tf 72 720 Td ${Array.from({ length: 4 }, () => '(Financial results 2026 revenue and profit in SAR millions.) Tj 0 -20 Td').join(' ')} ET`;
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objects.forEach((object, index) => { offsets.push(parts.join('').length); parts.push(`${index + 1} 0 obj\n${object}\nendobj\n`); });
  const xref = parts.join('').length;
  parts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return parts.join('');
}

test('only the configured watchlist entities and exact approved HTTPS hosts are accepted', () => {
  assert.deepEqual(PILOT_COMPANIES.map(item => item.id), ['hmg', 'aramco', 'sabic', 'stc', 'almarai', 'baan', 'alrajhi', 'kafd', 'humain']);
  const company = getPilotCompany('hmg');
  for (const url of ['http://hmg.com/report.pdf', 'https://hmg.com.evil.test/report.pdf', 'https://hmg.com@127.0.0.1/a', 'https://user:pass@hmg.com/a', 'https://hmg.com:8443/a', 'file:///etc/passwd', 'https://127.0.0.1/a']) {
    assert.throws(() => validateSourceUrl(url, company));
    assert.equal(isAllowedCompanySourceUrl('hmg', url), false);
  }
  assert.equal(validateSourceUrl('https://hmg.com/report.pdf#page=1', company), 'https://hmg.com/report.pdf');
  assert.equal(isAllowedCompanySourceUrl('almarai', 'https://almmedia.almarai.com/FinancialReports/example.pdf'), true);
  assert.equal(isAllowedCompanySourceUrl('baan', 'https://www.saudiexchange.sa/Resources/fsPdf/report.pdf'), true);
  assert.equal(isAllowedCompanySourceUrl('hmg', 'https://alhokair.argaam-ir.com/report.pdf'), false);
});

test('unknown companies cannot cause even one fetch', async () => {
  let calls = 0;
  await assert.rejects(collectCompanySources('http://localhost', { fetchImpl: async () => { calls += 1; } }));
  assert.equal(calls, 0);
});

test('an off-domain redirect is rejected before it is fetched', async () => {
  const requested = [];
  const result = await collectCompanySources('hmg', { fetchImpl: async (url, init) => {
    requested.push(url);
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
  } });
  assert.equal(requested.length, 2);
  assert.ok(requested.every(url => url.startsWith('https://hmg.com/')));
  assert.equal(result.evidence.length, 0);
  assert.ok(result.issues.some(issue => issue.includes('حُجب رابط')));
});

test('cross-company redirects are rejected and official relative redirects are allowed', async () => {
  const requested = [];
  const result = await collectCompanySources('hmg', { fetchImpl: async url => {
    requested.push(url);
    if (url.endsWith('home.aspx')) return new Response(null, { status: 302, headers: { location: '/ir/en/financial-results' } });
    if (url.endsWith('financial-results')) return htmlResponse(reportHtml);
    return new Response(null, { status: 302, headers: { location: 'https://www.sabic.com/en/investors' } });
  } });
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].url, 'https://hmg.com/ir/en/financial-results');
  assert.equal(requested.some(url => url.includes('sabic')), false);
});

test('streamed oversize content is stopped even without content-length', async () => {
  let cancelled = false;
  const result = await collectCompanySources('hmg', { maxBytes: 100, fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(101)); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/html' } }) });
  assert.equal(cancelled, true);
  assert.equal(result.evidence.length, 0);
  assert.ok(result.issues.some(issue => issue.includes('حد التنزيل')));
});

test('HTML strips instructions in scripts/navigation and fingerprints ignore retrieval time', async () => {
  const first = await collectCompanySources('hmg', { now: () => '2026-11-01T00:00:00Z', fetchImpl: async () => htmlResponse(reportHtml) });
  const second = await collectCompanySources('hmg', { now: () => '2026-11-02T00:00:00Z', fetchImpl: async () => htmlResponse(reportHtml) });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.evidence[0].checkedAt, second.evidence[0].checkedAt);
  assert.ok(first.evidence.every(item => !item.text.includes('BAD SCRIPT') && !item.text.includes('BAD NAVIGATION')));
  const changed = await collectCompanySources('hmg', { fetchImpl: async () => htmlResponse(reportHtml.replace('Revenue and profit', 'Revenue increased and profit')) });
  assert.notEqual(first.fingerprint, changed.fingerprint);
});

test('discovery follows recent official financial PDFs, never off-domain links or arbitrary archives', async () => {
  const requests = [];
  const hub = reportHtml.replace('</main>', '<a href="https://evil.test/financialQ3-2026.pdf">Q3 2026 financial statements</a><a href="/financialQ3-2026.pdf">Q3 2026 financial statements</a><a href="/privacy.pdf">privacy policy</a></main>');
  const result = await collectCompanySources('stc', { fetchImpl: async url => {
    requests.push(url);
    return htmlResponse(url.includes('financial-statement.html') ? hub : reportHtml);
  } });
  assert.ok(requests.includes('https://www.stc.com/financialQ3-2026.pdf'));
  assert.ok(requests.every(url => !url.includes('evil') && !url.includes('privacy')));
  assert.ok(result.evidence.length <= 3);
});

test('partial text and blocked/scanned sources are reported, not invented', async () => {
  const result = await collectCompanySources('hmg', { maxText: 180, fetchImpl: async () => htmlResponse(reportHtml) });
  assert.equal(result.evidence[0].text.length, 180);
  assert.equal(result.evidence[0].truncated, true);
  assert.ok(result.issues.some(issue => issue.includes('قراءة جزئية')));
  const blocked = await collectCompanySources('hmg', { fetchImpl: async () => htmlResponse('<main>Access Denied</main>') });
  assert.equal(blocked.evidence.length, 0);
  assert.ok(blocked.issues.some(issue => issue.includes('لم تُجمع أدلة')));
});

test('actual PDF parsing records page locators and uses the installed unpdf lifecycle', async () => {
  const result = await collectCompanySources('hmg', { fetchImpl: async url => url.endsWith('.pdf')
    ? new Response(pdfFixture(), { headers: { 'content-type': 'application/pdf' } })
    : htmlResponse(reportHtml),
  });
  const pdf = result.evidence.find(item => item.kind === 'pdf');
  assert.ok(pdf, 'PDF must survive parsing and cleanup, not become a generic extraction error');
  assert.equal(pdf.pagesRead, 1);
  assert.equal(pdf.totalPages, 1);
  assert.match(pdf.text, /\[صفحة 1\]/);
  assert.match(pdf.text, /SAR millions/);
});

test('unrendered Angular variables are not treated as current financial evidence', async () => {
  const template = '<main><h1>Investor relations</h1>{{item.Title}} {{item.FinancialStatement}}' + 'Investor relations report archive news. '.repeat(15) + '</main>';
  const result = await collectCompanySources('hmg', { fetchImpl: async () => htmlResponse(template) });
  assert.equal(result.evidence.length, 0);
  assert.ok(result.issues.some(issue => issue.includes('ديناميكيًا')));
});


test('approved statement import receives original bytes and gives each revision a stable identity', async () => {
  const original = pdfFixture();
  const imports = [];
  const url = getPilotCompany('almarai').sourceUrls[1];
  const result = await collectCompanySources('almarai', {
    fetchImpl: async requested => requested === url ? new Response(original) : htmlResponse(reportHtml),
    importPdf: async (company, source, bytes) => {
      const allowed = new Set(['almarai']);
      assert.equal(collectedPdfRecord(company, source, bytes, new Set()), null);
      assert.equal(collectedPdfRecord(company, {...source,url:source.url + '?alternate'}, bytes, allowed), null);
      const document = collectedPdfRecord(company, source, bytes, allowed);
      assert.equal(document.period, '2026-Q3');
      assert.equal(document.ticker, '2280');
      assert.equal(document.pageCount, 1);
      assert.equal(new TextDecoder().decode(bytes), original);
      assert.equal(collectedPdfRecord(company, source, bytes, allowed).id, document.id);
      assert.notEqual(collectedPdfRecord(company, source, new TextEncoder().encode(original + '\n'), allowed).id, document.id);
      imports.push(document);
      return true;
    },
  });
  assert.equal(imports.length, 1, JSON.stringify(result.issues));
  assert.ok(result.evidence.some(item => item.url === url));
  assert.ok(result.issues.some(issue => issue.includes('استُورد')));
});

test('archive failure keeps source evidence available for drafting', async () => {
  const result = await collectCompanySources('almarai', {
    fetchImpl: async () => new Response(pdfFixture()),
    importPdf: async () => { throw new Error('storage unavailable'); },
  });
  assert.ok(result.evidence.length > 0);
  assert.ok(result.issues.some(issue => issue.includes('تعذّر استيراد')));
});

test('Al Rajhi research reads its public earnings release and rejects off-domain documents', async () => {
  const bank = getPilotCompany('alrajhi');
  const release = bank.sourceUrls[0];
  assert.equal(bank.ticker,'1120');
  const result = await collectCompanySources(bank.id, {fetchImpl: async url => {
    if (url === release) return new Response(pdfFixture());
    return htmlResponse(reportHtml.replace('</main>','<a href="https://objectstorage.me-jeddah-1.oraclecloud.com/restricted.pdf">Financial results Q3 2026</a></main>'));
  }});
  assert.ok(result.evidence.some(item=>item.url===release && item.kind==='pdf'));
  assert.ok(result.evidence.every(item=>isAllowedCompanySourceUrl(bank.id,item.url)));
});
