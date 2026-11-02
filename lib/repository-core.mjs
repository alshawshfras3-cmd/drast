import { analyzeStudy } from './study-engine.mjs';
import { documentPath, validateUploadPath, MAX_FILE_BYTES, MAX_TEXT_BYTES } from './access-policy.mjs';
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
    async saveStudy(owner, study) {
      const prefix = root(owner);
      if (!study || typeof study !== 'object' || !safeId(study.id) || typeof study.company !== 'string' || !study.company.trim() || study.company.length > 200 || !Array.isArray(study.sources) || !Array.isArray(study.quarters) || study.sources.length > 100 || study.quarters.length > 40) throw Error('بنية الدراسة غير صحيحة.');
      if (new TextEncoder().encode(JSON.stringify(study)).length > 500000) throw Error('الدراسة تتجاوز الحد المسموح.');
      const errors = analyzeStudy(study).checks.filter(check => check.level === 'error');
      if (errors.length) throw Error(errors.map(check => check.message).join(' — '));
      const payload = { ...study, status: 'draft', updatedAt: new Date().toISOString() };
      await store.write(`${prefix}studies/${study.id}.json`, payload);
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
