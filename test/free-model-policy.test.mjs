import test from 'node:test';
import assert from 'node:assert/strict';
import { freeModelConfig, freeRequestBody, parseReportJson } from '../lib/free-model-policy.mjs';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

test('trial defaults to sources inventory without a key', () => {
  assert.deepEqual(freeModelConfig({}), { configured: false, provider: 'OpenRouter', model: 'openrouter/free', freeOnly: true, mode: 'sources_only' });
});
test('paid models and auto routers cannot be configured', () => {
  for (const model of ['openrouter/auto', 'qwen/qwen3.6-plus', 'https://evil.test/free', 'anything']) assert.throws(() => freeModelConfig({ DRAST_FREE_MODEL: model }));
  assert.equal(freeModelConfig({ DRAST_FREE_MODEL: 'qwen/example:free', OPENROUTER_API_KEY: 'test' }).configured, true);
});
test('request policy overrides cost parameters and removes paid tools/fallbacks', () => {
  const body = freeRequestBody({ messages: [], model: 'paid', models: ['paid'], tools: [{}], tool_choice: 'auto', plugins: [{ id: 'web' }], provider: { max_price: { prompt: 5 } } }, 'openrouter/free');
  assert.deepEqual(body.provider, { max_price: { prompt: 0, completion: 0, request: 0 }, allow_fallbacks: false });
  assert.deepEqual(body.plugins, []);
  assert.equal(body.tools, undefined); assert.equal(body.models, undefined); assert.equal(body.model, 'openrouter/free');
  assert.deepEqual(freeRequestBody({}, 'nvidia/nemotron-3.5-lightning:free').reasoning, { enabled: false });
});
test('model response must contain an entire JSON object, never prose or a partial object', () => {
  assert.deepEqual(parseReportJson('```json\n{"title":"test"}\n```'), { title: 'test' });
  assert.throws(() => parseReportJson('Here is {"title":"test"}'));
  assert.throws(() => parseReportJson('{"title":'));
});

test('installed SDK sends the enforced zero-price request and reads a compatible response', async () => {
  let sent;
  const provider = createOpenAICompatible({
    name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', apiKey: 'mock-key',
    transformRequestBody: body => freeRequestBody(body, 'openrouter/free'),
    fetch: async (url, options) => {
      assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
      sent = JSON.parse(options.body);
      return Response.json({ id: 'mock', object: 'chat.completion', created: 1, model: 'mock/free-model', choices: [{ index: 0, message: { role: 'assistant', content: '{"title":"اختبار"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } });
    },
  });
  const result = await generateText({ model: provider.chatModel('openrouter/free'), prompt: 'test', maxOutputTokens: 100, maxRetries: 0 });
  assert.equal(sent.max_tokens, 100);
  assert.equal(sent.provider.max_price.request, 0);
  assert.equal(sent.provider.allow_fallbacks, false);
  assert.equal(result.text, '{"title":"اختبار"}');
});
