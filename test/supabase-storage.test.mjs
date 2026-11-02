import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Compile the server-only module for isolated contract tests; no live service is used.
const source=readFileSync(new URL('../lib/supabase-storage.ts',import.meta.url),'utf8');
const executable=source.replace("import 'server-only';",'').replace("'./access-policy.mjs'",JSON.stringify(new URL('../lib/access-policy.mjs',import.meta.url).href));
const {outputText}=ts.transpileModule(executable,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const api=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const origin='https://independent-test.supabase.co';
const path='drast/private-workspace/files/250b425e-75aa-4e4d-85b7-61a31924dada.pdf';
const recordPath='drast/private-workspace/records/studies/test.json';
const bucket='drast-documents';
const keys=['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY'];
function setup(t,handler){
 const previous=new Map(keys.map(key=>[key,process.env[key]])),originalFetch=globalThis.fetch;
 process.env.SUPABASE_URL=origin;process.env.SUPABASE_SECRET_KEY='sb_secret_unit_test_not_real';delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 globalThis.fetch=handler||(async()=>{throw Error('Unexpected request');});
 t.after(()=>{globalThis.fetch=originalFetch;for(const [key,value]of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
}
test('configuration is server-only, private-key based and refuses malformed origins',t=>{
 setup(t);assert.match(source,/import 'server-only'/);assert.equal(api.storageReady(),true);assert.equal(api.supabaseProjectRef(),'independent-test');
 process.env.SUPABASE_SECRET_KEY='sb_publishable_not_a_server_key';assert.equal(api.storageReady(),false);
 process.env.SUPABASE_SECRET_KEY='sb_secret_unit_test_not_real';process.env.SUPABASE_URL='https://user:pass@example.com';assert.equal(api.storageReady(),false);
 process.env.SUPABASE_URL='http://project.supabase.co';assert.equal(api.storageReady(),false);
});
test('REST uses opaque secret only in apikey, no cache or redirects, and rejects external paths',async t=>{
 let calls=0;setup(t,async(url,init)=>{calls++;assert.equal(url.origin,origin);assert.equal(init.headers.get('apikey'),'sb_secret_unit_test_not_real');assert.equal(init.headers.get('authorization'),null);assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');return Response.json([]);});
 await api.supabaseFetch('/rest/v1/research_jobs?limit=1',{headers:{authorization:'Bearer forged'}});
 for(const bad of ['https://evil.example/rest/v1/test','//evil.example/rest/v1/test','/auth/v1/users','/rest/v1/../../auth/v1/users'])await assert.rejects(api.supabaseFetch(bad));
 assert.equal(calls,1);
});
test('legacy service-role JWT remains server-side and is supplied as Bearer',async t=>{
 const jwt='eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.not-real';
 setup(t,async(_,init)=>{assert.equal(init.headers.get('apikey'),jwt);assert.equal(init.headers.get('authorization'),'Bearer '+jwt);return Response.json([]);});
 delete process.env.SUPABASE_SECRET_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY=jwt;assert.equal(api.storageReady(),true);
 await api.supabaseFetch('/rest/v1/research_jobs');
 process.env.SUPABASE_SECRET_KEY=jwt;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 assert.equal(api.storageReady(),true);await api.supabaseFetch('/rest/v1/research_jobs');
 process.env.SUPABASE_SECRET_KEY='eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.not-real';
 assert.equal(api.storageReady(),false);
});
test('JSON records survive independent adapter reads and preserve owner-scoped upsert semantics',async t=>{
 const rows=new Map();setup(t,async(url,init)=>{
  assert.equal(url.pathname,'/rest/v1/drast_records');
  if(init.method==='POST'){const row=JSON.parse(init.body);assert.equal(row.owner,'private-workspace');assert.equal(init.headers.get('prefer'),'resolution=merge-duplicates,return=minimal');rows.set(row.pathname,row.payload);return new Response(null,{status:201});}
  assert.equal(url.searchParams.get('owner'),'eq.private-workspace');
  if(url.searchParams.get('select')==='pathname')return Response.json([...rows.keys()].map(pathname=>({pathname})));
  const value=rows.get(url.searchParams.get('pathname').slice(3));return Response.json(value?[{payload:value}]:[]);
 });
 assert.equal(await api.storage.read(recordPath),null);await api.storage.write(recordPath,{id:'test',company:'اختبار'});
 assert.deepEqual(await api.storage.read(recordPath),{id:'test',company:'اختبار'});
 assert.deepEqual(await api.storage.list('drast/private-workspace/records/studies/'),[recordPath]);
 await assert.rejects(api.storage.write('../escape',{id:'test'}));await assert.rejects(api.storage.list('drast/'));
});
test('record responses and list bounds cannot silently produce partial success',async t=>{
 setup(t,async()=>Response.json(Array.from({length:1001},()=>({pathname:recordPath}))));
 await assert.rejects(api.storage.list('drast/private-workspace/records/studies/'));
 globalThis.fetch=async()=>Response.json({error:'bad'});await assert.rejects(api.storage.read(recordPath));
});
test('signed upload grants are path-specific PUTs with no secret or public read URL',async t=>{
 setup(t,async(url,init)=>{assert.equal(url.pathname,`/storage/v1/object/upload/sign/${bucket}/${path}`);assert.equal(init.method,'POST');assert.equal(init.headers.get('x-upsert'),'false');return Response.json({url:`/object/upload/sign/${bucket}/${path}?token=temporary-upload-token&ignored=1`});});
 const grant=await api.createSignedDocumentUpload(path,'application/pdf',200);
 assert.equal(grant.method,'PUT');assert.equal(grant.pathname,path);assert.equal(grant.headers['Content-Type'],'application/pdf');
 assert.equal(new URL(grant.uploadUrl).origin,origin);assert.equal(new URL(grant.uploadUrl).searchParams.has('ignored'),false);
 assert.equal(JSON.stringify(grant).includes('sb_secret'),false);assert.equal(grant.expiresIn,7200);
 for(const size of [0,-1,15*1024*1024+1,'100'])await assert.rejects(api.createSignedDocumentUpload(path,'application/pdf',size));
 await assert.rejects(api.createSignedDocumentUpload(path,'text/html',200));
 await assert.rejects(api.createSignedDocumentUpload('../file.pdf','application/pdf',200));
});
test('unexpected cross-origin or mismatched signed upload URLs are rejected',async t=>{
 setup(t,async()=>Response.json({url:'https://evil.example/storage/v1/object/upload/sign/drast-documents/a.pdf?token=bad'}));
 await assert.rejects(api.createSignedDocumentUpload(path,'application/pdf',200));
 globalThis.fetch=async()=>Response.json({url:`/object/upload/sign/${bucket}/different.pdf?token=bad`});
 await assert.rejects(api.createSignedDocumentUpload(path,'application/pdf',200));
});
test('registration reads actual Storage size and MIME instead of browser claims',async t=>{
 setup(t,async(url)=>{assert.equal(url.pathname,`/storage/v1/object/info/${bucket}/${path}`);return Response.json({metadata:{size:200,mimetype:'application/pdf'}});});
 assert.deepEqual(await api.storage.head(path),{pathname:path,size:200,contentType:'application/pdf'});
 globalThis.fetch=async()=>Response.json({size:15*1024*1024+1,content_type:'application/pdf'});await assert.rejects(api.storage.head(path));
 globalThis.fetch=async()=>Response.json({size:200,content_type:'text/html'});await assert.rejects(api.storage.head(path));
});
test('downloads stream privately and absent files remain absent',async t=>{
 setup(t,async(url)=>{assert.equal(url.pathname,`/storage/v1/object/${bucket}/${path}`);return new Response('file-content',{headers:{'content-length':'12'}});});
 const file=await api.storage.file(path);assert.equal(file.statusCode,200);assert.equal(await new Response(file.stream).text(),'file-content');
 globalThis.fetch=async()=>new Response(null,{status:404});assert.equal(await api.storage.file(path),null);
});
test('readiness checks actually query the table and enforce private, bounded bucket configuration',async t=>{
 setup(t,async url=>url.pathname.startsWith('/rest/')?Response.json([]):Response.json({id:bucket,public:false,file_size_limit:15*1024*1024}));
 assert.deepEqual(await api.verifyStorageConnection(),{recordsReady:true,bucketReady:true});
 globalThis.fetch=async url=>url.pathname.startsWith('/rest/')?Response.json([]):Response.json({id:bucket,public:true,file_size_limit:15*1024*1024});
 await assert.rejects(api.verifyStorageConnection());
});
test('JSON body reader enforces actual UTF-8 bytes even when Content-Length is absent or understated',async t=>{
 setup(t);assert.equal(await api.readBoundedRequestText(new Request('https://app.test',{method:'POST',body:'اختبار'}),12),'اختبار');
 await assert.rejects(api.readBoundedRequestText(new Request('https://app.test',{method:'POST',headers:{'content-length':'1'},body:'س'.repeat(10)}),12),{status:413});
 await assert.rejects(api.readBoundedRequestText(new Request('https://app.test',{method:'POST',headers:{'content-length':'100'},body:'x'}),12),{status:413});
});
