import { randomUUID } from 'node:crypto';
import { PILOT_COMPANIES } from './pilot-catalog.mjs';
import { normalizeFinancialFacts, quartersFromFacts } from './finance/financial-facts.mjs';
import { pinFinancialFacts } from './finance/approve-financial-facts.mjs';
import { analyzeStudy } from './study-engine.mjs';
import { documentPath, validateUploadPath, MAX_FILE_BYTES, MAX_TEXT_BYTES } from './access-policy.mjs';
const reviewedIdPrefix = 'financial-facts-v1-';
const safeId = id => typeof id === 'string' && /^[-a-zA-Z0-9_]{1,80}$/.test(id);
const root = owner => {
  if (owner !== 'private-workspace') throw Error('مساحة غير مصرح بها.');
  return `drast/${owner}/records/`;
};
export function createRepository(store, seeds) {
  return {
    async listStudies(owner) {
      const saved = await Promise.all((await store.list(root(owner) + 'studies/')).map(path => store.read(path)));
      const all = new Map(seeds.map(study => [study.id, study]));
      for (const study of saved.filter(Boolean)) all.set(study.id, study);
      return [...all.values()];
    },
    async readReviewedStudy(owner, id) {
      if (!safeId(id) || !id.startsWith(reviewedIdPrefix)) return null;
      return store.read(root(owner) + 'studies/' + id + '.json');
    },
    async saveStudy(owner, study, confirmFinancialFacts = false) {
      const prefix = root(owner);
      if (!study || typeof study !== 'object' || !safeId(study.id) || typeof study.company !== 'string' || !study.company.trim() || study.company.length > 200 || !Array.isArray(study.sources) || study.sources.length > 100) throw Error('بنية الدراسة غير صحيحة.');
      if (new TextEncoder().encode(JSON.stringify(study)).length > 500000) throw Error('الدراسة تتجاوز الحد المسموح.');

      const hasFacts = Object.hasOwn(study, 'financialFacts') || Object.hasOwn(study, 'financialFactsVersion');
      if (!hasFacts && study.id.startsWith(reviewedIdPrefix)) throw Error('هذه نسخة مراجعة ثابتة. استورد سجل الحقائق لإنشاء نسخة جديدة.');
      let normalized = study;
      let facts;
      if (hasFacts) {
        if (confirmFinancialFacts !== true) throw Error('أكد مراجعة الخلايا في المستند الأصلي من واجهة استيراد الدراسة.');
        facts = normalizeFinancialFacts(study);
        normalized = {
          id:reviewedIdPrefix + randomUUID(), company:study.company, ticker:study.ticker, year:study.year,
          asOf:study.asOf, sector:study.sector, researchCompanyId:PILOT_COMPANIES.find(company => company.ticker === study.ticker)?.id,
          financialFactsVersion:1, statementScope:study.statementScope, sources:study.sources,
          quarters:quartersFromFacts(facts, study.year), findings:[],
          coverage:'الأرقام من سجل الحقائق المراجعة في مساحة العمل.',
          limitations:['تشمل المقارنة الأرباع المستقلة والأرصدة الختامية المسجلة بالريال السعودي.'],
          nextWatch:[],
        };
      }
      if (!Array.isArray(normalized.quarters) || normalized.quarters.length > 40) throw Error('بنية أرباع الدراسة غير صحيحة.');
      const errors = analyzeStudy(normalized).checks.filter(check => check.level === 'error');
      if (errors.length) throw Error(errors.map(check => check.message).join(' — '));

      const approved = facts ? await pinFinancialFacts(store, prefix, facts) : null;
      const updatedAt = new Date().toISOString();
      const payload = {
        ...normalized, status:'draft', updatedAt,
        ...(approved ? {financialFacts:approved, financialFactReview:{confirmedBy:owner, confirmedAt:updatedAt}} : {}),
      };
      if (!approved) delete payload.financialFactReview;
      await store.write(prefix + 'studies/' + payload.id + '.json', payload);
      return payload;
    },
    async listDocuments(owner) {
      const documents = await Promise.all((await store.list(root(owner) + 'documents/')).map(path => store.read(path)));
      return documents.filter(Boolean).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(({pathname,text,...summary}) => summary);
    },
    async readDocument(owner, id) {
      if (!safeId(id)) return null;
      const doc = await store.read(`${root(owner)}documents/${id}.json`);
      if (!doc) return null;
      const {pathname,...safe} = doc;
      return safe;
    },
    async readFile(owner, id) {
      if (!safeId(id)) return null;
      const doc = await store.read(`${root(owner)}documents/${id}.json`);
      if (!doc) return null;
      return { doc, file: await store.file(doc.pathname) };
    },
    async saveDocument(owner, input) {
      const prefix = root(owner);
      if (!input || typeof input !== 'object' || typeof input.name !== 'string' || !input.name.trim() || typeof input.text !== 'string') throw Error('بيانات الملف غير صالحة.');
      const pathname = documentPath(input.id, input.name.split('.').at(-1)?.toLowerCase());
      if (input.pathname !== pathname) throw Error('مسار الملف لا يطابق بياناته.');
      validateUploadPath(pathname);
      if (new TextEncoder().encode(input.text).length > MAX_TEXT_BYTES) throw Error('النص المستخرج كبير جدًا؛ قسّم التقرير.');
      const metadata = await store.head(pathname);
      if (metadata.pathname !== pathname || !metadata.size || metadata.size > MAX_FILE_BYTES) throw Error('ارفع ملفًا صالحًا حتى 15 ميجابايت.');
      const pageCount = Number(input.pageCount);
      if (!Number.isInteger(pageCount) || pageCount < 0 || pageCount > 300) throw Error('عدد الصفحات غير صالح.');
      const doc = {
        id: input.id, pathname, name: input.name.slice(0,250),
        company: String(input.company || '').slice(0,200), ticker: String(input.ticker || '').slice(0,20), period: String(input.period || '').slice(0,30),
        mime: metadata.contentType, size: metadata.size, pageCount, text: input.text,
        extractionStatus: input.text.replace(/\[صفحة \d+\]/g,'').replace(/\s/g,'').length > 30 ? 'text_ready' : 'needs_ocr',
        createdAt: new Date().toISOString(),
      };
      await store.write(`${prefix}documents/${doc.id}.json`,doc);
      const {pathname:_,text,...summary} = doc;
      return summary;
    },
  };
}

