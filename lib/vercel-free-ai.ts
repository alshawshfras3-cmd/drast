import { createGateway, generateText } from 'ai';
import { VERCEL_FREE_MODEL, VERCEL_FREE_PROVIDER, verifyZeroPriceEndpoint, vercelFreeConfig } from './vercel-free-policy.mjs';

export async function generateVercelFreeText(prompt: string, maxOutputTokens = 3200) {
  if (!vercelFreeConfig().configured) throw new Error('VERCEL_OIDC_MISSING');
  const catalogResponse = await fetch(`https://ai-gateway.vercel.sh/v1/models/${VERCEL_FREE_MODEL}/endpoints`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!catalogResponse.ok) throw new Error('FREE_MODEL_UNAVAILABLE');
  verifyZeroPriceEndpoint(await catalogResponse.json());
  // This deployment's short-lived OIDC token is the only authentication used.
  // No team keys, provider keys, reporting tags, BYOK, paid tools or fallbacks.
  const provider = createGateway({
    apiKey: '', // force SDK OIDC instead of any inherited team API key
    fetch: async (url, options) => {
      const target = new URL(String(url));
      if (target.protocol !== 'https:' || target.hostname !== 'ai-gateway.vercel.sh') throw new Error('MODEL_ENDPOINT_BLOCKED');
      return fetch(url, { ...options, redirect: 'error' });
    },
  });
  const result = await generateText({
    model: provider(VERCEL_FREE_MODEL), prompt, maxOutputTokens,
    providerOptions: { gateway: { only: [VERCEL_FREE_PROVIDER] } },
    reasoning: 'none', maxRetries: 0, abortSignal: AbortSignal.timeout(50_000),
  });
  if (result.finishReason === 'length') throw new Error('REPORT_TRUNCATED');
  const metadata = result.providerMetadata?.gateway as any;
  const cost = metadata?.cost === undefined ? null : Number(metadata.cost);
  if (cost !== null && (!Number.isFinite(cost) || cost > 0)) throw new Error('FREE_MODEL_PRICE_CHANGED');
  return { text: result.text, model: result.response.modelId || VERCEL_FREE_MODEL, provider: 'Vercel AI Gateway', cost };
}
