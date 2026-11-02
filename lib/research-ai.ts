import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { freeModelConfig, freeRequestBody } from './free-model-policy.mjs';
import { buildResearchPrompt, createSourcesOnlyReport, preparePromptEvidence } from './research-contract.mjs';
import { draftWithValidation, reportDiagnostic, shortSourceReferences } from './report-drafting.mjs';
import { vercelFreeConfig } from './vercel-free-policy.mjs';
import { generateVercelFreeText } from './vercel-free-ai';

export function researchProviderStatus() {
  if (process.env.OPENROUTER_API_KEY?.trim()) return freeModelConfig();
  const vercel = vercelFreeConfig();
  return vercel.configured ? vercel : freeModelConfig();
}

export async function draftResearch(input: any) {
  const config = researchProviderStatus();
  if (!config.configured) return { report: createSourcesOnlyReport(input), mode: 'sources_only', model: null };
  const selectedEvidence = preparePromptEvidence(input.evidence, input.companyIds);
  const references = shortSourceReferences(selectedEvidence);
  const generated = await draftWithValidation({ prompt: buildResearchPrompt({ ...input, evidence: references.evidence }), evidence: references.evidence, companyIds: input.companyIds, generate: (prompt: string, timeout: number) => generateResearchText(prompt, 3200, timeout) });
  const report = references.restore(generated.report);
  report.limitations = [...new Set([...report.limitations, ...(input.issues || [])])];
  return { report, mode: 'ai', model: generated.model, provider: generated.provider, cost: generated.cost };
}

/** The connection test and real drafts use exactly the same configured route. */
export async function generateResearchText(prompt: string, maxOutputTokens = 3200, timeoutMs = 50_000) {
  const config = researchProviderStatus();
  if (!config.configured) throw new Error('MODEL_NOT_CONFIGURED');
  if (config.provider === 'Vercel AI Gateway') return generateVercelFreeText(prompt, maxOutputTokens, timeoutMs);
  let actualModel = config.model;
  const provider = createOpenAICompatible({
    name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: { 'X-Title': 'Drast private research pilot' },
    transformRequestBody: (body) => freeRequestBody(body, config.model),
    fetch: async (url, options) => {
      if (String(url) !== 'https://openrouter.ai/api/v1/chat/completions') throw new Error('MODEL_ENDPOINT_BLOCKED');
      const result = await fetch(url, { ...options, redirect: 'error' });
      if (result.ok) {
        const data: any = await result.clone().json().catch(() => null);
        if (typeof data?.model === 'string') actualModel = data.model.slice(0, 180);
      }
      return result;
    },
  });
  const result = await generateText({
    model: provider.chatModel(config.model), prompt,
    maxOutputTokens, maxRetries: 0, abortSignal: AbortSignal.timeout(Math.min(50_000, Math.max(1000, timeoutMs))),
  });
  if (result.finishReason === 'length') throw new Error('REPORT_TRUNCATED');
  if (!result.text.trim()) throw new Error('MODEL_EMPTY_RESPONSE');
  return { text: result.text, model: actualModel, provider: 'OpenRouter', cost: null };
}

// Do not expose upstream response bodies, prompts or credentials in errors.
export function researchError(error: unknown): { message: string; status: number; diagnostic?: {stage:string;attempt:number;reason:string;field?:string} } {
  const diagnostic = reportDiagnostic(error);
  const safe = researchErrorMessage(error);
  if (!diagnostic) return safe;
  const stageNames: Record<string,string> = {generation:'استجابة النموذج',parsing:'قراءة JSON',validation:'فحص التقرير'};
  return {...safe,diagnostic,message:`${safe.message} المرحلة: ${stageNames[diagnostic.stage]}، المحاولة ${diagnostic.attempt}، الرمز ${diagnostic.reason}${diagnostic.field ? `، الحقل ${diagnostic.field}` : ''}.`};
}
function researchErrorMessage(error: unknown): {message:string;status:number} {
  const validationCode = (error as any)?.code;
  const validationMessages: Record<string,string> = {
    UNSUPPORTED_FINANCIAL_NUMBER: 'أوقف فحص الأرقام المسودة: تضمنت مبلغًا أو نسبة لا تطابق نص الأدلة المستشهد بها. لم تُعتمد هذه الأرقام.',
    UNSUPPORTED_PAGE_REFERENCE: 'أوقفت المراجعة المسودة لأن إحالة صفحة لم تظهر في مقتطفات المصدر.',
    UNKNOWN_REPORT_SOURCE: 'أوقفت المراجعة المسودة لأن النموذج أشار إلى معرّف مصدر غير مرفق.',
    UNSOURCED_REPORT_SECTION: 'أوقفت المراجعة المسودة لأن أحد أقسامها بلا مصدر.',
    INVALID_TEXT_LENGTH: 'لم تُعتمد المسودة لأن أحد نصوصها تجاوز الحجم المطلوب.',
    INVALID_REPORT_JSON: 'رد النموذج لم يطابق صيغة التقرير المطلوبة؛ لم تُعتمد المسودة.',
    INVALID_REPORT: 'لم يُعد النموذج كائن تقرير صالحًا؛ لم تُعتمد المسودة.',
    INVALID_REPORT_SECTIONS: 'لم تُعتمد المسودة لأن قائمة أقسامها مفقودة أو خارج العدد المسموح.',
    INVALID_REPORT_SECTION: 'لم تُعتمد المسودة لأن نوع أحد أقسامها غير صالح.',
    INVALID_REPORT_LIST: 'لم تُعتمد المسودة لأن قائمة القيود أو المتابعة مفقودة أو غير صالحة.',
    INVALID_TEXT: 'لم تُعتمد المسودة لأن أحد حقول النص المطلوبة مفقود أو بصيغة غير نصية.',
    REPORT_TOO_LARGE: 'لم تُعتمد المسودة لأنها تجاوزت حجم التقرير المسموح.',
  };
  if (validationMessages[validationCode]) {
    const detail = validationCode === 'UNSUPPORTED_FINANCIAL_NUMBER' ? (error as any)?.details : null;
    const locator = detail && /^(القسم \d{1,2}|الخلاصة|القيود والمتابعة)$/.test(detail.field) && /^[+\-\d.,]{1,40}$/.test(detail.token) ? ` الموضع: ${detail.field}؛ الرقم المرفوض: ${detail.token}.` : '';
    return {status:422,message:validationMessages[validationCode] + locator};
  }
  const diagnostic = [String((error as any)?.message || ''), String((error as any)?.type || ''), String((error as any)?.cause?.message || ''), String((error as any)?.cause?.responseBody || '')].join(' ');
  if (String((error as any)?.message || '').includes('FREE_MODEL_')) return { status: 503, message: 'المسار المجاني غير متاح أو تغير سعره. توقفت الصياغة دون استخدام بديل مدفوع.' };
  if (diagnostic.includes('customer_verification_required')) return { status: 503, message: 'يتطلب حساب Vercel اعتماد الوصول إلى AI Gateway قبل تشغيل النموذج. لم تُفعّل مدفوعات أو تعبئة رصيد تلقائية.' };
  const tagged = reportDiagnostic(error);
  const code = (error as any)?.statusCode ?? (tagged?.reason?.startsWith('UPSTREAM_') ? Number(tagged.reason.slice(9)) : undefined);
  if (tagged?.reason === 'MODEL_TIMEOUT') return {status:504,message:'انتهت مهلة النموذج. المصادر محفوظة ويمكن استئناف الصياغة.'};
  if (diagnostic.includes('REPORT_TRUNCATED')) return { status: 422, message: 'بلغ رد النموذج حد الإخراج قبل اكتماله. لم تُعتمد مسودة ناقصة؛ المصادر محفوظة.' };
  if (diagnostic.includes('MODEL_EMPTY_RESPONSE')) return { status: 422, message: 'لم يُرجع المزوّد نصًا قابلًا للقراءة. لم يتأكد نجاح الاتصال بالنموذج.' };
  if (tagged?.stage === 'parsing') return {status:422,message:validationMessages.INVALID_REPORT_JSON};
  if (code === 400) return { status: 422, message: 'رفض المزوّد إعدادات طلب النموذج. يلزم تعديل الربط؛ لا حاجة إلى شحن رصيد لهذا الخطأ.' };
  if (code === 429) return { status: 429, message: 'بلغ النموذج المجاني حد الاستخدام أو تعذر توفره مؤقتًا. حُفظت المصادر؛ أعد المحاولة لاحقًا. لن ينتقل النظام إلى نموذج مدفوع.' };
  if (code === 401 || code === 403 || diagnostic.includes('VERCEL_OIDC_MISSING') || diagnostic.includes('MODEL_NOT_CONFIGURED')) return { status: 503, message: 'تعذر اعتماد الاتصال بالنموذج لهذا المشروع. راجع هوية Vercel للمشروع أو أضف مفتاح OpenRouter مخصصًا في إعدادات الاستضافة.' };
  if (code === 402 || code === 404 || code === 502 || code === 503) return { status: 503, message: 'لا يتوفر مسار مجاني مناسب الآن. حُفظت المصادر ولم يُستخدم بديل مدفوع.' };
  if ((error as any)?.name === 'TimeoutError' || (error as any)?.name === 'AbortError') return { status: 504, message: 'انتهت مهلة النموذج. المصادر محفوظة ويمكن استئناف الصياغة.' };
  return { status: 422, message: 'لم يجتز التقرير فحص البنية أو الاستشهادات أو اكتمل الرد بصورة غير صالحة. راجع المصادر وأعد الصياغة؛ لا تعتمد هذه المحاولة كتقرير.' };
}
