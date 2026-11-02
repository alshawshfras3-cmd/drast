export const DEFAULT_FREE_MODEL = 'openrouter/free';

export function freeModelConfig(env = process.env) {
  const model = (env.DRAST_FREE_MODEL || DEFAULT_FREE_MODEL).trim();
  if (model !== DEFAULT_FREE_MODEL && !/^[a-z0-9_.-]+\/[a-z0-9_.:-]+:free$/i.test(model)) {
    throw new Error('DRAST_FREE_MODEL يجب أن يكون openrouter/free أو معرّف نموذج ينتهي بـ :free.');
  }
  return { configured: Boolean(env.OPENROUTER_API_KEY?.trim()), provider: 'OpenRouter', model, freeOnly: true, mode: env.OPENROUTER_API_KEY?.trim() ? 'ai' : 'sources_only' };
}

// Enforced on the server for every request, independent of browser input.
export function freeRequestBody(body, model) {
  freeModelConfig({ DRAST_FREE_MODEL: model });
  const { models, tools, tool_choice, plugins, route, provider, ...safe } = body;
  return {
    ...safe, model, stream: false, plugins: [],
    // This pinned hybrid model allows reasoning to be disabled. Keep the small
    // connection test and bounded report budget available for visible output.
    ...(model === 'nvidia/nemotron-3.5-lightning:free' ? { reasoning: { enabled: false } } : {}),
    provider: { max_price: { prompt: 0, completion: 0, request: 0 }, allow_fallbacks: false },
  };
}

export function parseReportJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!raw.startsWith('{') || !raw.endsWith('}')) throw new Error('لم يعد النموذج تقرير JSON صالحًا.');
  return JSON.parse(raw);
}
