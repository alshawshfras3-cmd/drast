import test from 'node:test';
import assert from 'node:assert/strict';
import { draftWithValidation } from '../lib/report-drafting.mjs';

const evidence=[{id:'almarai-official',companyId:'almarai',title:'نتائج رسمية',url:'https://www.almarai.com/en/corporate/investors/press-releases',text:'بلغت الإيرادات 100 مليون ريال في الفترة المعلنة.',kind:'html',checkedAt:'2026-11-03T00:00:00Z'}];
const valid={title:'مسودة المراعي',summary:'تحتاج الفترة إلى مراجعة.',sections:[{title:'الإيرادات',body:'بلغت الإيرادات 100 مليون ريال وفق المصدر المرفق.',kind:'fact',sourceIds:['almarai-official']}],limitations:['يلزم الرجوع إلى القوائم.'],nextWatch:['مراجعة التدفقات.']};
const invoke=(generate,now)=>draftWithValidation({prompt:'أدلة عامة',evidence,companyIds:['almarai'],generate,now});
const output=report=>({text:JSON.stringify(report),model:'free-model'});

test('a valid draft uses one call and remains subject to the financial contract',async()=>{let calls=0;const result=await invoke(async()=>{calls++;return output(valid);});assert.equal(calls,1);assert.equal(result.report.sections[0].sourceIds[0],'almarai-official');});
test('a rejected number gets only one correction and both responses are validated',async()=>{let calls=0;const bad={...valid,sections:[{...valid.sections[0],body:'بلغت الإيرادات 999 مليون ريال.'}]};const result=await invoke(async(prompt,timeout)=>{calls++;assert.ok(timeout<=50000);if(calls===1)return output(bad);assert.match(prompt,/UNSUPPORTED_FINANCIAL_NUMBER/);return output(valid);});assert.equal(calls,2);assert.match(result.report.sections[0].body,/100/);await assert.rejects(invoke(async()=>output(bad)),error=>error.code==='UNSUPPORTED_FINANCIAL_NUMBER');});
test('malformed JSON is corrected once without becoming an accepted partial report',async()=>{let calls=0;const result=await invoke(async()=>++calls===1?{text:'{"title":'}:output(valid));assert.equal(calls,2);assert.equal(result.report.title,valid.title);});
test('quota and transport failures never trigger another request',async()=>{let calls=0;await assert.rejects(invoke(async()=>{calls++;throw Object.assign(new Error('quota'),{statusCode:429});}));assert.equal(calls,1);});
test('validation cannot start a correction when the request budget is nearly exhausted',async()=>{let calls=0,time=0;await assert.rejects(invoke(async()=>{calls++;time=45000;return{text:'invalid'};},()=>time));assert.equal(calls,1);});
