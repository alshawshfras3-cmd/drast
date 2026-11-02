import { parseReportJson } from './free-model-policy.mjs';
import { validateResearchReport } from './research-contract.mjs';

const repairable = new Set(['UNSUPPORTED_FINANCIAL_NUMBER', 'UNSUPPORTED_PAGE_REFERENCE', 'UNKNOWN_REPORT_SOURCE', 'UNSOURCED_REPORT_SECTION', 'INVALID_TEXT_LENGTH', 'INVALID_REPORT_JSON', 'INVALID_REPORT', 'INVALID_REPORT_SECTIONS', 'INVALID_REPORT_SECTION', 'INVALID_REPORT_LIST', 'INVALID_TEXT']);

/** One bounded correction may repair a rejected draft; neither pass bypasses validation. */
export async function draftWithValidation({ prompt, evidence, companyIds, generate, now = Date.now }) {
  const deadline = now() + 50_000;
  const validate = result => ({ ...result, report: validateResearchReport(parseReportJson(result.text), evidence, { companyIds }) });
  const first = await generate(prompt, 50_000);
  try { return validate(first); }
  catch (error) {
    const remaining = deadline - now();
    const canRepair = repairable.has(error?.code) || error instanceof SyntaxError || error?.message === 'لم يعد النموذج تقرير JSON صالحًا.';
    if (!canRepair || remaining < 8000) throw error;
    const reason = repairable.has(error?.code) ? error.code : 'INVALID_REPORT_JSON';
    const rejected = reason === 'UNSUPPORTED_FINANCIAL_NUMBER' && error?.details ? ` الرقم المرفوض في ${error.details.field}: ${error.details.token}.` : '';
    const corrected = await generate(`${prompt}\nتعليمات تصحيح بعد التدقيق: رُفضت المسودة السابقة بسبب ${reason}.${rejected} اكتب JSON جديدًا وموجزًا من الأدلة نفسها، من قسمين إلى أربعة أقسام، وبحد أقصى 350 كلمة. انسخ sourceIds حرفيًا من id في الأدلة. انقل أي رقم مالي حرفيًا بالمقياس والفترة الموجودين في مصدره، دون تقريب أو تحويل أو حساب. إذا تعذر النقل الدقيق فاستخدم وصفًا نوعيًا مسندًا وحدد النقص. تجنب أرقامًا جديدة في العنوان والخلاصة والتحليل. لا تُلغِ أي قاعدة سابقة.`, remaining);
    return validate(corrected);
  }
}
