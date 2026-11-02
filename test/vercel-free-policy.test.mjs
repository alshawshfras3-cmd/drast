import test from 'node:test';
import assert from 'node:assert/strict';
import { VERCEL_FREE_MODEL, vercelFreeConfig, verifyZeroPriceEndpoint } from '../lib/vercel-free-policy.mjs';
const catalog = () => ({ data: { id: VERCEL_FREE_MODEL, endpoints: [{ provider_name: 'nvidia', pricing: { prompt: '0', completion: '0', request: '0', image: '0', image_output: '0', web_search: '0', internal_reasoning: '0', input_cache_read: '0', discount: 0 } }] } });
test('Vercel uses this deployment OIDC without requiring a provider API key', () => {
  assert.equal(vercelFreeConfig({ VERCEL: '1', VERCEL_OIDC_TOKEN: 'test' }).configured, true);
  assert.equal(vercelFreeConfig({ OPENROUTER_API_KEY: 'other' }).configured, false);
});
test('the exact free endpoint blocks changed, missing or new metered prices', () => {
  assert.equal(verifyZeroPriceEndpoint(catalog()).provider, 'nvidia');
  for (const mutation of [data => data.data.id = 'paid/model', data => data.data.endpoints[0].pricing.request = '0.01', data => delete data.data.endpoints[0].pricing.completion, data => data.data.endpoints[0].pricing.input_cache_write = '0.1']) {
    const data = catalog(); mutation(data); assert.throws(() => verifyZeroPriceEndpoint(data));
  }
});
