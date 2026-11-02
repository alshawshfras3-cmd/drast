import test from 'node:test';
import assert from 'node:assert/strict';
import { draftWithValidation, reportDiagnostic, shortSourceReferences } from '../lib/report-drafting.mjs';

const evidence=[{id:'almarai-official',companyId:'almarai',title:'نتائج رسمية',url:'https://www.almarai.com/en/corporate/investors/press-releases',text:'بلغت الإيرادات 100 مليون ريال في الفترة المعلنة.',kind:'html',checkedAt:'2026-11-03T00:00:00Z'}];
const valid={title:'مسودة المراعي',summary:'تحتاج الفترة إلى مراجعة.',sections:[{title:'الإيرادات',body:'بلغت الإيرادات 100 مليون ريال وفق المصدر المرفق.',kind:'fact',sourceIds:['almarai-official']}],limitations:['يلزم الرجوع إلى القوائم.'],nextWatch:['مراجعة التدفقات.']};
const invoke=(generate,now)=>draftWithValidation({prompt:'أدلة عامة',evidence,companyIds:['almarai'],generate,now});
const output=report=>({text:JSON.stringify(report),model:'free-model'});

test('short citation labels round-trip to exact stored documents without mutating evidence',async()=>{
 const original=structuredClone(evidence),references=shortSourceReferences(evidence);
 assert.equal(references.evidence[0].id,'S1');assert.deepEqual(evidence,original);
 const generated=await draftWithValidation({prompt:'مصدر S1',evidence:references.evidence,companyIds:['almarai'],generate:async()=>output({...valid,sections:[{...valid.sections[0],sourceIds:['S1']}]})});
 assert.equal(references.restore(generated.report).sections[0].sourceIds[0],'almarai-official');
 const next=shortSourceReferences([{...evidence[0],id:'different-document'}]);
 assert.equal(next.restore(generated.report).sections[0].sourceIds[0],'different-document');
});
test('short labels never infer an unknown citation or borrow numbers from an uncited document',async()=>{
 const references=shortSourceReferences([...evidence,{...evidence[0],id:'second-document',text:'بلغت الإيرادات 200 مليون ريال في الفترة المعلنة.'}]);
 assert.throws(()=>references.restore({...valid,sections:[{...valid.sections[0],sourceIds:['S9']}]}),error=>error.code==='UNKNOWN_REPORT_SOURCE');
 await assert.rejects(draftWithValidation({prompt:'مصدران',evidence:references.evidence,companyIds:['almarai'],generate:async()=>output({...valid,sections:[{...valid.sections[0],body:'بلغت الإيرادات 200 مليون ريال.',sourceIds:['S1']}]})}),error=>error.code==='UNSUPPORTED_FINANCIAL_NUMBER');
 assert.throws(()=>shortSourceReferences([...evidence,evidence[0]]));
});

test('a valid draft uses one call and remains subject to the financial contract',async()=>{let calls=0;const result=await invoke(async()=>{calls++;return output(valid);});assert.equal(calls,1);assert.equal(result.report.sections[0].sourceIds[0],'almarai-official');});
test('a rejected number gets only one correction and both responses are validated',async()=>{let calls=0;const bad={...valid,sections:[{...valid.sections[0],body:'بلغت الإيرادات 999 مليون ريال.'}]};const result=await invoke(async(prompt,timeout)=>{calls++;assert.ok(timeout<=50000);if(calls===1)return output(bad);assert.match(prompt,/UNSUPPORTED_FINANCIAL_NUMBER/);assert.match(prompt,/الرقم المرفوض في القسم 1: 999/);return output(valid);});assert.equal(calls,2);assert.match(result.report.sections[0].body,/100/);await assert.rejects(invoke(async()=>output(bad)),error=>error.code==='UNSUPPORTED_FINANCIAL_NUMBER'&&error.details.token==='999');});
test('malformed JSON is corrected once without becoming an accepted partial report',async()=>{let calls=0;const result=await invoke(async()=>++calls===1?{text:'{"title":'}:output(valid));assert.equal(calls,2);assert.equal(result.report.title,valid.title);});
test('quota and transport failures never trigger another request',async()=>{let calls=0;await assert.rejects(invoke(async()=>{calls++;throw Object.assign(new Error('quota'),{statusCode:429});}));assert.equal(calls,1);});
test('validation cannot start a correction when the request budget is nearly exhausted',async()=>{let calls=0,time=0;await assert.rejects(invoke(async()=>{calls++;time=45000;return{text:'invalid'};},()=>time));assert.equal(calls,1);});
test('empty real responses fail at generation without a repair call',async()=>{let calls=0;await assert.rejects(invoke(async()=>{calls++;return{text:'  '};}),error=>{assert.deepEqual(reportDiagnostic(error),{stage:'generation',attempt:1,reason:'MODEL_EMPTY_RESPONSE'});return true;});assert.equal(calls,1);});
test('the final malformed JSON response reports parsing and attempt two without model text',async()=>{await assert.rejects(invoke(async()=>({text:'{"title":SECRET_INVALID_JSON'})),error=>{assert.deepEqual(reportDiagnostic(error),{stage:'parsing',attempt:2,reason:'INVALID_REPORT_JSON'});assert.equal(JSON.stringify(reportDiagnostic(error)).includes('SECRET'),false);return true;});});
test('missing report lists identify a safe schema field after bounded correction',async()=>{const bad={...valid};delete bad.nextWatch;await assert.rejects(invoke(async()=>output(bad)),error=>{assert.deepEqual(reportDiagnostic(error),{stage:'validation',attempt:2,reason:'INVALID_REPORT_LIST',field:'nextWatch'});return true;});});
test('correction generation errors preserve quota and nested timeout diagnostics',async()=>{for(const [failure,reason]of [[Object.assign(new Error('quota'),{statusCode:429}),'UPSTREAM_429'],[new Error('outer',{cause:Object.assign(new Error('timed out'),{name:'TimeoutError'})}),'MODEL_TIMEOUT']]){let calls=0;await assert.rejects(invoke(async()=>{if(++calls===1)return{text:'bad-json'};throw failure;}),error=>{assert.deepEqual(reportDiagnostic(error),{stage:'generation',attempt:2,reason});return true;});assert.equal(calls,2);}});
