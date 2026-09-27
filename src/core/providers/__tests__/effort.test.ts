import { afterEach, expect, test } from 'bun:test';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { OpenAICompatProvider } from '../openai-compat.js';
import { AnthropicProvider } from '../anthropic.js';
import { OllamaProvider, ollamaThink } from '../ollama.js';
import type { ChatMessage } from '../../types.js';

let server: FakeProviderServer | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

const user = (content: string): ChatMessage => ({ role: 'user', content, timestamp: 0 });
const lastBody = () => server!.completions().at(-1)!.body;

test('an OpenAI-compatible endpoint receives reasoning_effort as given, and none when reasoning is off', async () => {
  server = startFakeProvider();
  server.enqueue({ text: 'a' }, { text: 'b' }, { text: 'c' });
  const provider = new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl });
  await provider.complete([user('hi')], { model: 'm', reasoning: 'auto', effort: 'max' });
  expect(lastBody().reasoning_effort).toBe('max');
  await provider.complete([user('hi')], { model: 'm', reasoning: 'off', effort: 'high' });
  expect(lastBody().reasoning_effort).toBeUndefined();
  await provider.complete([user('hi')], { model: 'm', reasoning: 'auto' });
  expect(lastBody().reasoning_effort).toBeUndefined();
});

test("OpenRouter receives its reasoning object, with levels above high sent as high", async () => {
  server = startFakeProvider();
  server.enqueue({ text: 'a' }, { text: 'b' });
  const provider = new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl, name: 'openrouter', effortStyle: 'openrouter', reasoningParam: 'include_reasoning' });
  await provider.complete([user('hi')], { model: 'm', reasoning: 'on', effort: 'low' });
  expect(lastBody().reasoning).toEqual({ effort: 'low' });
  await provider.complete([user('hi')], { model: 'm', reasoning: 'on', effort: 'xhigh' });
  expect(lastBody().reasoning).toEqual({ effort: 'high' });
  expect(lastBody().reasoning_effort).toBeUndefined();
});

test('Anthropic receives output_config.effort only for a model that takes one', async () => {
  server = startFakeProvider();
  server.enqueue({ text: 'a' }, { text: 'b' });
  const provider = new AnthropicProvider({ baseUrl: server.anthropicBaseUrl, apiKey: 'k' });
  await provider.complete([user('hi')], { model: 'm', reasoning: 'auto', effort: 'xhigh', acceptsEffort: true, thinkingStyle: 'adaptive' });
  expect(lastBody().output_config).toEqual({ effort: 'xhigh' });
  await provider.complete([user('hi')], { model: 'm', reasoning: 'auto', effort: 'xhigh' });
  expect(lastBody().output_config).toBeUndefined();
});

test('Ollama sends a level to gpt-oss models and true to every other thinking model', async () => {
  expect(ollamaThink('gpt-oss:20b', 'medium')).toBe('medium');
  expect(ollamaThink('gpt-oss:120b', 'max')).toBe('high');
  expect(ollamaThink('qwen3:4b', 'high')).toBe(true);
  expect(ollamaThink('gpt-oss:20b', undefined)).toBe(true);
  server = startFakeProvider();
  server.enqueue({ text: 'a' });
  await new OllamaProvider({ endpoint: server.ollamaBaseUrl }).complete([user('hi')], { model: 'gpt-oss:20b', reasoning: 'auto', effort: 'low' });
  expect(lastBody().think).toBe('low');
});
