import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { freeModelConfig, freeRequestBody, parseReportJson } from './free-model-policy.mjs';
import { buildResearchPrompt, createSourcesOnlyReport, preparePromptEvidence, validateResearchReport } from './research-contract.mjs';
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
  if (config.provider === 'Vercel AI Gateway') {
    const generated = await generateVercelFreeText(buildResearchPrompt({ ...input, evidence: selectedEvidence }));
    const report = validateResearchReport(parseReportJson(generated.text), selectedEvidence, { companyIds: input.companyIds });
    report.limitations = [...new Set([...report.limitations, ...(input.issues || [])])];
    return { report, mode: 'ai', model: generated.model, provider: generated.provider, cost: generated.cost };
  }
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
    model: provider.chatModel(config.model), prompt: buildResearchPrompt({ ...input, evidence: selectedEvidence }),
    maxOutputTokens: 3200, maxRetries: 0, abortSignal: AbortSignal.timeout(50_000),
  });
  if (result.finishReason === 'length') throw new Error('REPORT_TRUNCATED');
  const report = validateResearchReport(parseReportJson(result.text), selectedEvidence, { companyIds: input.companyIds });
  report.limitations = [...new Set([...report.limitations, ...(input.issues || [])])];
  return { report, mode: 'ai', model: actualModel };
}

// Do not expose upstream response bodies, prompts or credentials in errors.
export function researchError(error: unknown): { message: string; status: number } {
  const diagnostic = [String((error as any)?.message || ''), String((error as any)?.type || ''), String((error as any)?.cause?.message || ''), String((error as any)?.cause?.responseBody || '')].join(' ');
  if (String((error as any)?.message || '').includes('FREE_MODEL_')) return { status: 503, message: 'المسار المجاني غير متاح أو تغير سعره. توقفت الصياغة دون استخدام بديل مدفوع.' };
  if (diagnostic.includes('customer_verification_required')) return { status: 503, message: 'يتطلب حساب Vercel اعتماد الوصول إلى AI Gateway قبل تشغيل النموذج. لم تُفعّل مدفوعات أو تعبئة رصيد تلقائية.' };
  const code = (error as any)?.statusCode;
  if (code === 429) return { status: 429, message: 'بلغ النموذج المجاني حد الاستخدام أو تعذر توفره مؤقتًا. حُفظت المصادر؛ أعد المحاولة لاحقًا. لن ينتقل النظام إلى نموذج مدفوع.' };
  if (code === 401 || code === 403 || diagnostic.includes('VERCEL_OIDC_MISSING')) return { status: 503, message: 'تعذر اعتماد الاتصال بالنموذج لهذا المشروع. راجع هوية Vercel للمشروع أو مفتاحه المخصص.' };
  if (code === 402 || code === 404 || code === 502 || code === 503) return { status: 503, message: 'لا يتوفر مسار مجاني مناسب الآن. حُفظت المصادر ولم يُستخدم بديل مدفوع.' };
  if ((error as any)?.name === 'TimeoutError' || (error as any)?.name === 'AbortError') return { status: 504, message: 'انتهت مهلة النموذج. المصادر محفوظة ويمكن استئناف الصياغة.' };
  return { status: 422, message: 'لم يجتز التقرير فحص البنية أو الاستشهادات أو اكتمل الرد بصورة غير صالحة. راجع المصادر وأعد الصياغة؛ لا تعتمد هذه المحاولة كتقرير.' };
}
