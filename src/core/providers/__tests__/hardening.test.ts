import { afterEach, expect, test } from 'bun:test';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { OpenAICompatProvider } from '../openai-compat.js';
import { AnthropicProvider } from '../anthropic.js';
import { OllamaProvider, DEFAULT_OLLAMA_CONTEXT_CAP } from '../ollama.js';
import { ProviderError, extractErrorText, parseRetryAfter, type RetryInfo } from '../http.js';
import type { ChatMessage } from '../../types.js';

let server: FakeProviderServer | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

const user = (content: string): ChatMessage => ({ role: 'user', content, timestamp: 0 });
const fast = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 50 };

const drain = async (stream: AsyncGenerator<any>) => {
  const chunks: any[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
};

test('a rate-limited request waits as told and succeeds on retry', async () => {
  server = startFakeProvider();
  server.enqueue({ status: 429, headers: { 'retry-after-ms': '30' }, errorBody: { error: { message: 'slow down' } } }, { text: 'ok' });
  const retries: RetryInfo[] = [];
  const provider = new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl, retryPolicy: fast });
  const result = await provider.complete([user('hi')], { model: 'm', onRetry: (info) => retries.push(info) });
  expect(result.content).toBe('ok');
  expect(retries).toHaveLength(1);
  expect(retries[0]).toMatchObject({ attempt: 1, delayMs: 30 });
  expect(retries[0].reason).toContain('429 slow down');
  expect(server.completions()).toHaveLength(2);
});

test('a rejected request reports the provider message and a fix, without retrying', async () => {
  server = startFakeProvider();
  server.enqueue({ status: 401, errorBody: { error: { message: 'Invalid API key sk-live-abcdefghijklmnop' } } });
  const provider = new OpenAICompatProvider({
    baseUrl: server.openaiBaseUrl,
    name: 'openrouter',
    keyVariable: 'OPENROUTER_API_KEY',
    retryPolicy: fast,
  });
  const error = (await provider.complete([user('hi')], { model: 'm' }).catch((e) => e)) as ProviderError;
  expect(error).toBeInstanceOf(ProviderError);
  expect(error.message).toContain('openrouter returned 401: Invalid API key [redacted]');
  expect(error.message).toContain('OPENROUTER_API_KEY');
  expect(error.message).not.toContain('abcdefghijklmnop');
  expect(server.completions()).toHaveLength(1);
});

test('an endpoint that rejects stream_options is asked again without it', async () => {
  server = startFakeProvider();
  server.enqueue(
    { status: 400, errorBody: { error: { message: 'Unrecognized request argument supplied: stream_options' } } },
    { text: 'fine', usage: { prompt: 1, completion: 1 } }
  );
  const provider = new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl, retryPolicy: fast });
  const chunks = await drain(provider.streamChat([user('hi')], { model: 'm' }));
  expect(chunks.map((c) => c.content).join('')).toBe('fine');
  const [first, second] = server.completions();
  expect(first.body.stream_options).toEqual({ include_usage: true });
  expect(second.body.stream_options).toBeUndefined();
});

test('streamed usage is requested and reported', async () => {
  server = startFakeProvider();
  server.enqueue({ text: 'hi', usage: { prompt: 7, completion: 3 } });
  const provider = new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl });
  const chunks = await drain(provider.streamChat([user('hi')], { model: 'm' }));
  expect(chunks.find((c) => c.done)?.usage).toEqual({ prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
});

test('reasoning from another provider family is not replayed to Anthropic', async () => {
  server = startFakeProvider();
  server.enqueue({ text: 'ok' });
  const provider = new AnthropicProvider({ baseUrl: server.anthropicBaseUrl });
  const history: ChatMessage[] = [
    user('first'),
    { role: 'assistant', content: 'answer', reasoning: 'deepseek style thinking', providerFamily: 'openai', timestamp: 0 },
    user('second'),
  ];
  await provider.complete(history, { model: 'claude-x' });
  const body = server.completions()[0].body;
  expect(JSON.stringify(body)).not.toContain('thinking');
  expect(body.messages[1].content).toEqual([{ type: 'text', text: 'answer' }]);
});

test('signed Anthropic reasoning is replayed to Anthropic with its signature', async () => {
  server = startFakeProvider();
  server.enqueue({ reasoning: 'think', reasoningSignature: 'sig-1', toolCalls: [{ name: 'read_file', arguments: { path: 'a' } }] });
  const provider = new AnthropicProvider({ baseUrl: server.anthropicBaseUrl });
  const chunks = await drain(provider.streamChat([user('go')], { model: 'claude-x' }));
  const done = chunks.find((c) => c.done);
  expect(done.reasoningBlocks).toEqual([{ type: 'thinking', text: 'think', signature: 'sig-1' }]);

  server.enqueue({ text: 'done' });
  await provider.complete(
    [
      user('go'),
      {
        role: 'assistant',
        content: '',
        providerFamily: 'anthropic',
        reasoningBlocks: done.reasoningBlocks,
        tool_calls: done.toolCalls,
        timestamp: 0,
      },
      { role: 'tool', content: 'file text', tool_call_id: done.toolCalls[0].id, timestamp: 0 },
    ],
    { model: 'claude-x' }
  );
  const replay = server.completions()[1].body.messages[1].content;
  expect(replay[0]).toEqual({ type: 'thinking', thinking: 'think', signature: 'sig-1' });
  expect(replay[1].type).toBe('tool_use');
});

test('Ollama requests always carry num_ctx', async () => {
  server = startFakeProvider({ models: [{ id: 'big', contextLength: 131072 }, { id: 'small', contextLength: 4096 }] });
  server.enqueue({ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' });

  await new OllamaProvider({ endpoint: server.ollamaBaseUrl, numCtx: 24576 }).complete([user('x')], { model: 'big' });
  const provider = new OllamaProvider({ endpoint: server.ollamaBaseUrl });
  await provider.complete([user('x')], { model: 'big' });
  await provider.complete([user('x')], { model: 'small' });
  await provider.complete([user('x')], { model: 'unknown-model' });

  const sizes = server.completions().map((request) => request.body.options.num_ctx);
  expect(sizes).toEqual([24576, DEFAULT_OLLAMA_CONTEXT_CAP, 4096, 8192]);
});

test('Ollama tool calls that arrive before the final chunk are kept', async () => {
  server = startFakeProvider();
  server.enqueue({ text: 'Reading.', toolCalls: [{ id: 'call_7', name: 'read_file', arguments: { path: 'a.ts' } }] });
  const provider = new OllamaProvider({ endpoint: server.ollamaBaseUrl });
  const chunks = await drain(provider.streamChat([user('read')], { model: 'fake-model', tools: [] }));
  const done = chunks.find((c) => c.done);
  expect(done.toolCalls).toEqual([
    { id: 'call_7', type: 'function', function: { name: 'read_file', arguments: { path: 'a.ts' } } },
  ]);
});

test('an unreachable Ollama says how to start it', async () => {
  const provider = new OllamaProvider({ endpoint: 'http://127.0.0.1:1', retryPolicy: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } });
  const error = (await provider.complete([user('x')], { model: 'm' }).catch((e) => e)) as ProviderError;
  expect(error).toBeInstanceOf(ProviderError);
  expect(error.message).toContain('ollama could not be reached');
  expect(error.message).toContain('ollama serve');
});

test('a request with no model is refused with the ways to set one', async () => {
  const provider = new OpenAICompatProvider({ baseUrl: 'http://127.0.0.1:1', name: 'openrouter' });
  await expect(provider.complete([user('x')], {})).rejects.toThrow('No model is configured for openrouter');
});

test('retry delays are read from seconds, dates, and milliseconds', () => {
  expect(parseRetryAfter(new Headers({ 'retry-after': '2' }))).toBe(2000);
  expect(parseRetryAfter(new Headers({ 'retry-after-ms': '150' }))).toBe(150);
  const inAMinute = new Date(Date.now() + 60_000).toUTCString();
  const fromDate = parseRetryAfter(new Headers({ 'retry-after': inAMinute }))!;
  expect(fromDate).toBeGreaterThan(55_000);
  expect(fromDate).toBeLessThanOrEqual(60_000);
  expect(parseRetryAfter(new Headers())).toBeUndefined();
});

test('error text is pulled from the shapes providers use', () => {
  expect(extractErrorText('{"error":{"message":"bad model"}}')).toBe('bad model');
  expect(extractErrorText('{"error":"model not found"}')).toBe('model not found');
  expect(extractErrorText('{"message":"quota"}')).toBe('quota');
  expect(extractErrorText('upstream   timed out')).toBe('upstream timed out');
});
