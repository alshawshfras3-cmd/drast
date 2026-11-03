import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tesseract = dirname(require.resolve('tesseract.js/package.json'));
const pdfjs = dirname(require.resolve('pdfjs-dist/package.json'));
const core = dirname(createRequire(join(tesseract, 'package.json')).resolve('tesseract.js-core/package.json'));
const lang = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
const target = fileURLToPath(new URL('../public/ocr/', import.meta.url));

await Promise.all(['core', 'lang'].map(dir => mkdir(join(target, dir), { recursive: true })));
const runtime = (await readdir(core)).filter(name => /^tesseract-core.*\.wasm(?:\.js)?$/.test(name));
if (!runtime.length) throw new Error('No pinned OCR runtime files found');
await Promise.all([
  copyFile(join(pdfjs, 'build', 'pdf.worker.min.mjs'), join(target, '..', 'pdf.worker.min.mjs')),
  copyFile(join(tesseract, 'dist', 'worker.min.js'), join(target, 'worker.min.js')),
  copyFile(join(lang, '4.0.0_best_int', 'eng.traineddata.gz'), join(target, 'lang', 'eng.traineddata.gz')),
  ...runtime.map(name => copyFile(join(core, name), join(target, 'core', name))),
]);
