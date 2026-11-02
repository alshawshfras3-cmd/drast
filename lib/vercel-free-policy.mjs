export const VERCEL_FREE_MODEL = 'nvidia/nemotron-3.5-lightning-free';
export const VERCEL_FREE_PROVIDER = 'nvidia';

export function vercelFreeConfig(env = process.env) {
  // In hosted Functions the SDK reads OIDC from the request context, not
  // VERCEL_OIDC_TOKEN (which is normally a build/development variable).
  // This means ready to attempt authentication, not a verified connection.
  const configured = env.VERCEL === '1';
  return { configured, provider: 'Vercel AI Gateway', model: VERCEL_FREE_MODEL, freeOnly: true, mode: configured ? 'ai' : 'sources_only' };
}

// Check the exact serving endpoint, including reasoning/cache/request prices.
// A changed or unavailable price blocks generation instead of selecting a paid SKU.
export function verifyZeroPriceEndpoint(catalog) {
  if (catalog?.data?.id !== VERCEL_FREE_MODEL) throw new Error('FREE_MODEL_UNAVAILABLE');
  const endpoint = catalog.data.endpoints?.find(item => item.provider_name === VERCEL_FREE_PROVIDER);
  const keys = ['prompt', 'completion', 'request', 'image', 'image_output', 'web_search', 'internal_reasoning', 'input_cache_read'];
  if (!endpoint || !endpoint.pricing || keys.some(key => endpoint.pricing[key] === undefined || Number(endpoint.pricing[key]) !== 0)) throw new Error('FREE_MODEL_PRICE_CHANGED');
  for (const [key, value] of Object.entries(endpoint.pricing)) {
    if (key !== 'discount' && (typeof value !== 'string' && typeof value !== 'number' || Number(value) !== 0)) throw new Error('FREE_MODEL_PRICE_CHANGED');
  }
  return { model: VERCEL_FREE_MODEL, provider: VERCEL_FREE_PROVIDER };
}
