import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workspaceActor, sameOrigin, documentPath, validateUploadPath, MAX_FILE_BYTES, MAX_TEXT_BYTES } from '../lib/access-policy.mjs';
import { createRepository } from '../lib/repository-core.mjs';
const owner='private-workspace';
const seed=JSON.parse(readFileSync(new URL('../data/hmg.json',import.meta.url)));
const id='250b425e-75aa-4e4d-85b7-61a31924dada';
const path=documentPath(id,'pdf');
function setup(){
 const records=new Map(),files=new Map([[path,{pathname:path,size:200,contentType:'application/pdf'}]]);
 const store={read:async p=>structuredClone(records.get(p)??null),write:async(p,v)=>{records.set(p,structuredClone(v));},list:async prefix=>[...records.keys()].filter(p=>p.startsWith(prefix)),head:async p=>{if(!files.has(p))throw Error('missing');return files.get(p);},file:async p=>files.get(p)??null};
 return {repo:createRepository(store,[seed]),records,files};
}
const report=()=>({id,pathname:path,name:'تقرير.pdf',text:'[صفحة 1]\nإيرادات الربع وصافي الربح وأرصدة النقد موثقة في هذا التقرير.',company:'الحبيب',ticker:'4013',period:'2026-Q2',pageCount:1,size:1,mime:'text/html'});
test('production ignores forged Sites identity headers and requires configured private gateway',()=>{
 const req=new Request('https://drast-frias-projects12.vercel.app/api/workspace',{headers:{'oai-authenticated-user-id':'someone'}});
 assert.equal(workspaceActor(req,{NODE_ENV:'production'}),null);
 assert.equal(workspaceActor(req,{NODE_ENV:'production',VERCEL:'1'}),null);
 assert.equal(workspaceActor(req,{NODE_ENV:'production',VERCEL:'1',DRAST_PRIVATE_WORKSPACE:'enabled'}),owner);
 assert.equal(workspaceActor(new Request('https://drast.vercel.app/api/workspace'),{NODE_ENV:'production',VERCEL:'1',DRAST_PRIVATE_WORKSPACE:'enabled'}),owner);
});
test('production refuses custom or unknown hosts; development is loopback-only',()=>{
 assert.equal(workspaceActor(new Request('https://unprotected.example/api'),{VERCEL:'1',DRAST_PRIVATE_WORKSPACE:'enabled'}),null);
 assert.equal(workspaceActor(new Request('https://other.vercel.app/api'),{VERCEL:'1',DRAST_PRIVATE_WORKSPACE:'enabled'}),null);
 assert.equal(workspaceActor(new Request('http://127.0.0.1:3000/api'),{NODE_ENV:'development'}),owner);
 assert.equal(workspaceActor(new Request('https://public.example/api'),{NODE_ENV:'development'}),null);
});
test('writes require an exact origin including port',()=>{
 assert.equal(sameOrigin(new Request('https://app.example/api',{headers:{origin:'https://evil.example'}})),false);
 assert.equal(sameOrigin(new Request('https://app.example/api')),false);
 assert.equal(sameOrigin(new Request('https://app.example/api',{headers:{origin:'https://app.example'}})),true);
});
test('Next.js internal URLs use the actual request Host and TLS proxy protocol',()=>{
 const req=new Request('http://127.0.0.1:3000/api',{headers:{host:'drast-frias-projects12.vercel.app','x-forwarded-proto':'https',origin:'https://drast-frias-projects12.vercel.app'}});
 assert.equal(workspaceActor(req,{VERCEL:'1',DRAST_PRIVATE_WORKSPACE:'enabled'}),owner);
 assert.equal(sameOrigin(req),true);
 const wrong=new Request(req.url,{headers:{host:'drast-frias-projects12.vercel.app','x-forwarded-proto':'https',origin:'https://evil.example'}});
 assert.equal(sameOrigin(wrong),false);
});
test('upload scope rejects traversal, records paths and unsupported extensions',()=>{
 assert.equal(validateUploadPath(path).id,id);
 for(const bad of ['../studies/x.json','drast/private-workspace/records/studies/x.json',path+'.exe',path.replace(id,'..')])assert.throws(()=>validateUploadPath(bad));
 assert.throws(()=>documentPath(id,'html'));
});
test('saved studies survive a fresh repository instance and override seeds without duplicate rows',async()=>{
 const {repo,records}=setup();
 const saved=await repo.saveStudy(owner,{...seed,status:'approved',coverage:'تغطية محدثة'});
 assert.equal(saved.status,'draft');
 const fresh=createRepository({list:async()=>[...records.keys()],read:async p=>records.get(p)},[seed]);
 const studies=await fresh.listStudies(owner);
 assert.equal(studies.length,1);assert.equal(studies[0].coverage,'تغطية محدثة');
});
test('invalid study identifiers and different workspace cannot mutate storage',async()=>{
 const {repo,records}=setup();
 await assert.rejects(repo.saveStudy(owner,{...seed,id:'../../escape'}));
 await assert.rejects(repo.saveStudy('another-user',seed));assert.equal(records.size,0);
});
test('report registration uses actual stored file size and MIME, retains page text and hides storage paths',async()=>{
 const {repo}=setup();
 const saved=await repo.saveDocument(owner,report());assert.equal(saved.size,200);assert.equal(saved.mime,'application/pdf');assert.equal(saved.extractionStatus,'text_ready');
 assert.equal(saved.pathname,undefined);assert.equal(saved.text,undefined);
 const read=await repo.readDocument(owner,id);assert.match(read.text,/صفحة 1/);assert.equal(read.pathname,undefined);
 const summaries=await repo.listDocuments(owner);assert.equal(summaries[0].text,undefined);assert.equal(summaries[0].pathname,undefined);
});
test('registration rejects external URLs, a mismatched id or an absent original upload',async()=>{
 const {repo,files,records}=setup();
 await assert.rejects(repo.saveDocument(owner,{...report(),pathname:'https://attacker.example/file.pdf'}));
 await assert.rejects(repo.saveDocument(owner,{...report(),id:'150b425e-75aa-4e4d-85b7-61a31924dada'}));
 files.clear();await assert.rejects(repo.saveDocument(owner,report()));assert.equal(records.size,0);
});
test('server enforces original file size and UTF-8 text byte limit',async()=>{
 const {repo,files,records}=setup();files.get(path).size=MAX_FILE_BYTES+1;
 await assert.rejects(repo.saveDocument(owner,report()));files.get(path).size=200;
 await assert.rejects(repo.saveDocument(owner,{...report(),text:'س'.repeat(MAX_TEXT_BYTES/2+1)}));assert.equal(records.size,0);
});
test('scanned reports stay marked for OCR and invalid page counts cannot be saved',async()=>{
 const {repo}=setup();assert.equal((await repo.saveDocument(owner,{...report(),text:'\n [صفحة 1]\n'})).extractionStatus,'needs_ocr');
 await assert.rejects(repo.saveDocument(owner,{...report(),pageCount:301}));
 await assert.rejects(repo.saveDocument(owner,{...report(),pageCount:NaN}));
});
test('downloads resolve only a registered id and never accept an arbitrary object path',async()=>{
 const {repo}=setup();assert.equal(await repo.readFile(owner,id),null);await repo.saveDocument(owner,report());
 assert.equal((await repo.readFile(owner,id)).file.pathname,path);assert.equal(await repo.readFile(owner,'../files/test'),null);
});
