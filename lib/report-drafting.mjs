import { parseReportJson } from './free-model-policy.mjs';
import { validateResearchReport } from './research-contract.mjs';

const repairable = new Set(['UNSUPPORTED_FINANCIAL_NUMBER', 'UNSUPPORTED_PAGE_REFERENCE', 'UNKNOWN_REPORT_SOURCE', 'UNSOURCED_REPORT_SECTION', 'INVALID_TEXT_LENGTH', 'INVALID_REPORT_JSON', 'INVALID_REPORT', 'INVALID_REPORT_SECTIONS', 'INVALID_REPORT_SECTION', 'INVALID_REPORT_LIST', 'INVALID_TEXT']);
const reasons = new Set([...repairable, 'REPORT_TOO_LARGE', 'MODEL_EMPTY_RESPONSE', 'REPORT_TRUNCATED', 'MODEL_GENERATION_FAILED', 'MODEL_TIMEOUT', 'MODEL_NOT_CONFIGURED', 'VERCEL_OIDC_MISSING', 'FREE_MODEL_UNAVAILABLE', 'FREE_MODEL_PRICE_CHANGED', ...[400,401,402,403,404,408,413,422,429,500,502,503,504].map(status => `UPSTREAM_${status}`)]);
const fields = ['title','summary','sections','section.title','section.body','limitations','nextWatch'];
export function reportDiagnostic(error) {
  const value = error?.reportDiagnostic;
  if (!value || !['generation','parsing','validation'].includes(value.stage) || ![1,2].includes(value.attempt) || !reasons.has(value.reason)) return null;
  return {stage:value.stage,attempt:value.attempt,reason:value.reason,...(fields.includes(value.field) ? {field:value.field} : {})};
}
function tagFailure(error, stage, attempt) {
  const failure = error instanceof Error ? error : new Error('REPORT_PIPELINE_FAILURE');
  let reason = stage === 'parsing' ? 'INVALID_REPORT_JSON' : reasons.has(failure.code) ? failure.code : 'MODEL_GENERATION_FAILED';
  if (stage === 'generation') {
    let current = failure;
    for (let depth=0; current && depth<4; depth++,current=current.cause) {
      if (['AbortError','TimeoutError'].includes(current.name)) {reason='MODEL_TIMEOUT';break;}
      if (reasons.has(current.message)) {reason=current.message;break;}
      if (reasons.has(`UPSTREAM_${current.statusCode}`)) {reason=`UPSTREAM_${current.statusCode}`;break;}
    }
  }
  const field = fields.find(name => failure.message?.includes(`الحقل ${name} `));
  failure.reportDiagnostic = {stage,attempt,reason,...(field ? {field} : {})};
  return failure;
}

/** One bounded correction may repair a rejected draft; neither pass bypasses validation. */
export async function draftWithValidation({ prompt, evidence, companyIds, generate, now = Date.now }) {
  const deadline = now() + 50_000;
  const run = async (requestPrompt, timeout, attempt) => {
    let result;
    try {
      result = await generate(requestPrompt,timeout);
      if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('MODEL_EMPTY_RESPONSE');
    } catch(error) {throw tagFailure(error,'generation',attempt);}
    let parsed;
    try {parsed=parseReportJson(result.text);} catch(error) {throw tagFailure(error,'parsing',attempt);}
    try {return {...result,report:validateResearchReport(parsed,evidence,{companyIds})};}
    catch(error) {throw tagFailure(error,'validation',attempt);}
  };
  try { return await run(prompt,50_000,1); }
  catch (error) {
    const remaining = deadline - now();
    const canRepair = error?.reportDiagnostic?.stage !== 'generation' && (repairable.has(error?.code) || error instanceof SyntaxError || error?.message === 'لم يعد النموذج تقرير JSON صالحًا.');
    if (!canRepair || remaining < 8000) throw error;
    const reason = repairable.has(error?.code) ? error.code : 'INVALID_REPORT_JSON';
    const rejected = reason === 'UNSUPPORTED_FINANCIAL_NUMBER' && error?.details ? ` الرقم المرفوض في ${error.details.field}: ${error.details.token}.` : '';
    return run(`${prompt}\nتعليمات تصحيح بعد التدقيق: رُفضت المسودة السابقة بسبب ${reason}.${rejected} اكتب JSON جديدًا وموجزًا من الأدلة نفسها، من قسمين إلى أربعة أقسام، وبحد أقصى 350 كلمة. انسخ sourceIds حرفيًا من id في الأدلة. انقل أي رقم مالي حرفيًا بالمقياس والفترة الموجودين في مصدره، دون تقريب أو تحويل أو حساب. إذا تعذر النقل الدقيق فاستخدم وصفًا نوعيًا مسندًا وحدد النقص. تجنب أرقامًا جديدة في العنوان والخلاصة والتحليل. لا تُلغِ أي قاعدة سابقة.`, remaining,2);
  }
}
