import { createHash } from 'node:crypto';
import { documentPath, MAX_FILE_BYTES } from '../access-policy.mjs';

async function hashDocument(store, doc) {
  const file = await store.file(doc.pathname);
  if (file?.statusCode !== 200 || !file.stream) throw Error('تعذّر قراءة نسخة المستند لاعتماد الرقم.');
  const reader = file.stream.getReader();
  const hash = createHash('sha256');
  let bytes = 0;
  const signature = Buffer.alloc(5);
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      if (bytes < signature.length) signature.set(value.subarray(0, signature.length - bytes), bytes);
      bytes += value.byteLength;
      if (bytes > MAX_FILE_BYTES) {
        await reader.cancel();
        throw Error('ملف الدليل يتجاوز حد الحجم.');
      }
      hash.update(value);
    }
  } finally { reader.releaseLock(); }
  if (bytes !== doc.size || signature.toString('ascii') !== '%PDF-') throw Error('نسخة ملف PDF لا تطابق بيانات الملف المحفوظ.');
  return hash.digest('hex');
}

export async function pinFinancialFacts(store, prefix, facts) {
  const documents = new Map();
  const approved = [];
  for (const fact of facts) {
    if (!documents.has(fact.documentId)) {
      const doc = await store.read(prefix + 'documents/' + fact.documentId + '.json');
      if (!doc || doc.id !== fact.documentId || doc.pathname !== documentPath(fact.documentId, 'pdf')) {
        throw Error('أرفق ملف PDF محفوظًا في مكتبة دراسات لكل دليل.');
      }
      documents.set(fact.documentId, {doc, sha256:await hashDocument(store, doc)});
    }
    const {doc,sha256} = documents.get(fact.documentId);
    if (doc.ticker !== fact.ticker || doc.period !== fact.period ||
        !Number.isInteger(doc.pageCount) || fact.cell.page > doc.pageCount) {
      throw Error('الشركة أو الفترة أو رقم الصفحة لا يطابق الملف المرفوع.');
    }
    approved.push({...fact, documentSha256:sha256, documentName:doc.name});
  }
  return approved;
}
