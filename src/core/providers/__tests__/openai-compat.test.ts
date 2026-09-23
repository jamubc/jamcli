import { test, expect, afterEach } from 'bun:test';
import { OpenAICompatProvider } from '../openai-compat.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const streamResponse = (chunks: string[]): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
};

const jsonResponse = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200 });

const collect = async (provider: OpenAICompatProvider, messages: any[], options: any = {}) => {
  const events: any[] = [];
  for await (const chunk of provider.streamChat(messages, options)) events.push(chunk);
  return events;
};

test('converts a request to the OpenAI wire format', async () => {
  let captured: any;
  globalThis.fetch = (async (url: any, init: any) => {
    captured = { url, body: JSON.parse(init.body), headers: init.headers };
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
  }) as unknown as typeof fetch;

  const provider = new OpenAICompatProvider({ apiKey: 'sk-test', baseUrl: 'https://example.test/v1/' });
  const result = await provider.complete(
    [
      { role: 'system', content: 'sys', timestamp: 0 },
      { role: 'user', content: 'hi', timestamp: 0 },
    ],
    {
      model: 'm-1',
      temperature: 0.3,
      tools: [{ type: 'function', function: { name: 'list_files', parameters: { type: 'object' } } }],
    }
  );

  expect(captured.url).toBe('https://example.test/v1/chat/completions');
  expect(captured.body.model).toBe('m-1');
  expect(captured.body.stream).toBe(false);
  expect(captured.body.temperature).toBe(0.3);
  expect(captured.body.messages).toEqual([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ]);
  expect(captured.body.tools[0].function.name).toBe('list_files');
  expect(captured.body.tool_choice).toBe('auto');
  expect(captured.headers.Authorization).toBe('Bearer sk-test');
  expect(result.content).toBe('ok');
});

test('streams content and reasoning deltas in order and ends with usage', async () => {
  globalThis.fetch = (async () =>
    streamResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"think-1"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning":"think-2","content":" world"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":5,"total_tokens":8}}\n\n',
      'data: [DONE]\n\n',
    ])) as unknown as typeof fetch;

  const provider = new OpenAICompatProvider({ baseUrl: 'https://example.test/v1' });
  const events = await collect(provider, [{ role: 'user', content: 'hi', timestamp: 0 }]);

  expect(events.map((event) => [event.reasoning ?? null, event.content, event.done])).toEqual([
    ['think-1', '', false],
    [null, 'Hello', false],
    ['think-2', ' world', false],
    [null, '', true],
  ]);
  expect(events[events.length - 1].usage).toEqual({
    prompt_tokens: 3,
    completion_tokens: 5,
    total_tokens: 8,
  });
});

test('assembles tool call fragments across a stream and yields them on the done chunk', async () => {
  globalThis.fetch = (async () =>
    streamResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_files","arguments":"{\\"pat"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"tern\\":\\"*.ts\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ])) as unknown as typeof fetch;

  const provider = new OpenAICompatProvider({ baseUrl: 'https://example.test/v1' });
  const events = await collect(provider, [{ role: 'user', content: 'hi', timestamp: 0 }]);
  const done = events.find((event) => event.done);

  expect(done?.toolCalls).toEqual([
    { id: 'call_1', type: 'function', function: { name: 'list_files', arguments: { pattern: '*.ts' } } },
  ]);
});

test('parses non-streaming tool calls and round-trips the tool messages on the way in', async () => {
  let captured: any;
  globalThis.fetch = (async (_url: any, init: any) => {
    captured = JSON.parse(init.body);
    return jsonResponse({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'call_9', function: { name: 'grep', arguments: '{"q":"x"}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
  }) as unknown as typeof fetch;

  const provider = new OpenAICompatProvider({ baseUrl: 'https://example.test/v1' });
  const result = await provider.complete(
    [
      {
        role: 'assistant',
        content: '',
        timestamp: 0,
        tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'grep', arguments: { q: 'x' } } }],
      },
      { role: 'tool', content: '1: x', timestamp: 0, tool_call_id: 'call_9' },
    ],
    { model: 'm' }
  );

  expect(result.toolCalls).toEqual([
    { id: 'call_9', type: 'function', function: { name: 'grep', arguments: { q: 'x' } } },
  ]);
  expect(result.usage).toEqual({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
  expect(captured.messages[0].tool_calls[0].id).toBe('call_9');
  expect(captured.messages[1].tool_call_id).toBe('call_9');
});

test('the compatible client never sets Anthropic-only headers', async () => {
  let headers: any;
  globalThis.fetch = (async (_url: any, init: any) => {
    headers = init.headers;
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
  }) as unknown as typeof fetch;

  const provider = new OpenAICompatProvider({ apiKey: 'sk-test', baseUrl: 'https://example.test/v1' });
  await provider.complete([{ role: 'user', content: 'hi', timestamp: 0 }], {});

  expect(headers['x-api-key']).toBeUndefined();
  expect(headers['anthropic-version']).toBeUndefined();
});
