import { afterEach, expect, test } from 'bun:test';
import { startFakeProvider, type FakeProviderServer } from '../fakeProvider.js';
import { OpenAICompatProvider } from '../../core/providers/openai-compat.js';
import { AnthropicProvider } from '../../core/providers/anthropic.js';
import { OllamaProvider } from '../../core/providers/ollama.js';
import type { ChatMessage } from '../../core/types.js';

let server: FakeProviderServer | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

const user = (content: string): ChatMessage => ({ role: 'user', content, timestamp: 0 });

const drain = async (stream: AsyncGenerator<any>) => {
  const chunks: any[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
};

const readCall = { name: 'read_file', arguments: { path: 'src/index.ts', start_line: 1 } };

test('openai: streams text in pieces and assembles a tool call', async () => {
  server = startFakeProvider();
  server.enqueue({ text: 'Let me look.', toolCalls: [readCall], usage: { prompt: 12, completion: 7 } });
  const provider = new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl, apiKey: 'sk-fake' });

  const chunks = await drain(provider.streamChat([user('read it')], { model: 'fake-model' }));
  const text = chunks.map((chunk) => chunk.content).join('');
  const done = chunks.find((chunk) => chunk.done);

  expect(text).toBe('Let me look.');
  expect(chunks.filter((chunk) => chunk.content).length).toBeGreaterThan(1);
  expect(done.toolCalls).toEqual([
    { id: 'call_fake_0', type: 'function', function: { name: 'read_file', arguments: readCall.arguments } },
  ]);
  const [request] = server.completions();
  expect(request.body.model).toBe('fake-model');
  expect(request.body.stream).toBe(true);
  expect(request.headers.authorization).toBe('Bearer sk-fake');
});

test('openai: emits usage only when the request asks for it', async () => {
  server = startFakeProvider();
  server.enqueue({ text: 'ok', usage: { prompt: 3, completion: 2 } });
  const response = await fetch(`${server.openaiBaseUrl}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model: 'm', stream: true, stream_options: { include_usage: true }, messages: [] }),
  });
  const body = await response.text();
  expect(body).toContain('"total_tokens":5');

  server.enqueue({ text: 'ok', usage: { prompt: 3, completion: 2 } });
  const bare = await fetch(`${server.openaiBaseUrl}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model: 'm', stream: true, messages: [] }),
  });
  expect(await bare.text()).not.toContain('total_tokens');
});

test('openai: non-streaming completion carries tool calls and usage', async () => {
  server = startFakeProvider();
  server.enqueue({ toolCalls: [readCall], usage: { prompt: 5, completion: 1 } });
  const provider = new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl });
  const result = await provider.complete([user('read it')], { model: 'fake-model' });
  expect(result.toolCalls?.[0].function.name).toBe('read_file');
  expect(result.usage).toEqual({ prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 });
});

test('anthropic: streams thinking, text, and a tool use', async () => {
  server = startFakeProvider();
  server.enqueue({
    reasoning: 'The user wants a file.',
    reasoningSignature: 'sig-abc',
    text: 'Reading.',
    toolCalls: [readCall],
    usage: { prompt: 20, completion: 9 },
  });
  const provider = new AnthropicProvider({ baseUrl: server.anthropicBaseUrl, apiKey: 'sk-ant-fake' });
  const chunks = await drain(provider.streamChat([user('read it')], { model: 'claude-fake' }));

  expect(chunks.map((chunk) => chunk.reasoning ?? '').join('')).toBe('The user wants a file.');
  expect(chunks.map((chunk) => chunk.content).join('')).toBe('Reading.');
  const done = chunks.find((chunk) => chunk.done);
  expect(done.toolCalls[0]).toEqual({
    id: 'toolu_fake_0',
    type: 'function',
    function: { name: 'read_file', arguments: readCall.arguments },
  });
  expect(done.usage).toEqual({ prompt_tokens: 20, completion_tokens: 9, total_tokens: 29 });
  expect(server.completions()[0].headers['x-api-key']).toBe('sk-ant-fake');
});

test('anthropic: non-streaming completion parses content blocks', async () => {
  server = startFakeProvider();
  server.enqueue({ text: 'Done.', toolCalls: [readCall] });
  const provider = new AnthropicProvider({ baseUrl: server.anthropicBaseUrl });
  const result = await provider.complete([user('read it')], { model: 'claude-fake' });
  expect(result.content).toBe('Done.');
  expect(result.toolCalls?.[0].id).toBe('toolu_fake_0');
});

test('ollama: non-streaming completion carries tool calls', async () => {
  server = startFakeProvider();
  server.enqueue({ toolCalls: [readCall], usage: { prompt: 8, completion: 4 } });
  const provider = new OllamaProvider({ endpoint: server.ollamaBaseUrl });
  const result = await provider.complete([user('read it')], { model: 'fake-model' });
  expect(result.toolCalls?.[0].function).toEqual({ name: 'read_file', arguments: readCall.arguments });
  expect(result.usage).toEqual({ prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 });
  expect(server.completions()[0].body.stream).toBe(false);
});

test('ollama: streams text across chunks', async () => {
  server = startFakeProvider();
  server.enqueue({ text: 'hello there', usage: { prompt: 2, completion: 3 } });
  const provider = new OllamaProvider({ endpoint: server.ollamaBaseUrl });
  const chunks = await drain(provider.streamChat([user('hi')], { model: 'fake-model' }));
  expect(chunks.map((chunk) => chunk.content).join('')).toBe('hello there');
  expect(chunks.find((chunk) => chunk.done)?.usage?.total_tokens).toBe(5);
});

test('ollama: streams tool calls that arrive before the final chunk', async () => {
  server = startFakeProvider();
  server.enqueue({ text: 'On it.', toolCalls: [readCall] });
  const provider = new OllamaProvider({ endpoint: server.ollamaBaseUrl });
  const chunks = await drain(provider.streamChat([user('read it')], { model: 'fake-model' }));
  expect(chunks.find((chunk) => chunk.done)?.toolCalls?.[0].function.name).toBe('read_file');
});

test('scripted failures carry their status, body, and headers', async () => {
  server = startFakeProvider();
  server.enqueue({ status: 429, headers: { 'retry-after': '1' }, errorBody: { error: { message: 'slow down' } } });
  const response = await fetch(`${server.openaiBaseUrl}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model: 'm', messages: [] }),
  });
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBe('1');
  expect(await response.json()).toEqual({ error: { message: 'slow down' } });
});

test('an exhausted script answers with a 500 that names the problem', async () => {
  server = startFakeProvider();
  const provider = new OpenAICompatProvider({
    baseUrl: server.openaiBaseUrl,
    retryPolicy: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
  });
  await expect(provider.complete([user('hi')], { model: 'm' })).rejects.toThrow('returned 500: fake provider: no scripted turn left');
});

test('a stream can be cut short without a terminal event', async () => {
  server = startFakeProvider();
  server.enqueue({ text: 'abcdefgh', chunkSize: 2, cutAfterEvents: 3 });
  const provider = new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl });
  const chunks = await drain(provider.streamChat([user('hi')], { model: 'm' }));
  expect(chunks.map((chunk) => chunk.content).join('')).toBe('abcd');
});

test('model routes list the configured models', async () => {
  server = startFakeProvider({
    models: [{ id: 'm1', contextLength: 8192, pricing: { prompt: '0.000001', completion: '0.000002' }, capabilities: ['tools'] }],
  });
  const openai = await (await fetch(`${server.openaiBaseUrl}/models`)).json();
  expect(openai.data[0]).toMatchObject({ id: 'm1', context_length: 8192, supported_parameters: ['tools', 'tool_choice'] });
  const show = await (await fetch(`${server.ollamaBaseUrl}/api/show`, { method: 'POST', body: JSON.stringify({ model: 'm1' }) })).json();
  expect(show.model_info['fake.context_length']).toBe(8192);
});
