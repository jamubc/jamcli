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

const collect = async (provider: OpenAICompatProvider, messages: any[], options: any = { model: 'm' }) => {
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
  await provider.complete([{ role: 'user', content: 'hi', timestamp: 0 }], { model: 'm' });

  expect(headers['x-api-key']).toBeUndefined();
  expect(headers['anthropic-version']).toBeUndefined();
});

const refusal = (message: string) => new Response(JSON.stringify({ error: { message } }), { status: 400 });

test('a model the endpoint serves only through the Responses API is asked that way, and remembered', async () => {
  const requests: { path: string; body: any }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(init.body);
    requests.push({ path, body });
    if (path.endsWith('/chat/completions')) return refusal('Model does not support this protocol.');
    return streamResponse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
      'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"why"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"lo"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]},{"type":"function_call","call_id":"call_1","name":"read_file","arguments":"{\\"path\\":\\"a\\"}"}],"usage":{"input_tokens":4,"output_tokens":6,"total_tokens":10,"input_tokens_details":{"cached_tokens":2}}}}\n\n',
    ]);
  }) as unknown as typeof fetch;
  const provider = new OpenAICompatProvider({ baseUrl: 'https://example.test/v1' });
  const messages = [
    { role: 'system', content: 'Be brief.', timestamp: 0 },
    { role: 'user', content: 'read it', timestamp: 0 },
    { role: 'assistant', content: '', timestamp: 0, tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'read_file', arguments: { path: 'z' } } }] },
    { role: 'tool', content: 'zzz', timestamp: 0, tool_call_id: 'call_0' },
  ];
  const tools = [{ type: 'function' as const, function: { name: 'read_file', parameters: { type: 'object' } } }];
  const events = await collect(provider, messages, { model: 'luna', tools, effort: 'max', reasoning: 'on' });
  expect(requests.map((request) => request.path)).toEqual(['/v1/chat/completions', '/v1/responses']);
  const sent = requests[1].body;
  expect(sent.input).toEqual([
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'read it' },
    { type: 'function_call', call_id: 'call_0', name: 'read_file', arguments: '{"path":"z"}' },
    { type: 'function_call_output', call_id: 'call_0', output: 'zzz' },
  ]);
  expect(sent.tools).toEqual([{ type: 'function', name: 'read_file', description: undefined, parameters: { type: 'object' } }]);
  expect(sent.reasoning).toEqual({ effort: 'xhigh', summary: 'auto' });
  expect(events.map((event) => [event.content, event.reasoning ?? null, event.done])).toEqual([
    ['Hel', null, false],
    ['', 'why', false],
    ['lo', null, false],
    ['', null, true],
  ]);
  const last = events.at(-1)!;
  expect(last.toolCalls).toEqual([{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: { path: 'a' } } }]);
  expect(last.usage).toEqual({ prompt_tokens: 4, completion_tokens: 6, total_tokens: 10, cached_tokens: 2 });
  expect(last.stopReason).toBe('tool_calls');
  // The next request for that model goes straight to the Responses API.
  await collect(provider, messages, { model: 'luna' });
  expect(requests.map((request) => request.path)).toEqual(['/v1/chat/completions', '/v1/responses', '/v1/responses']);
});

test('an effort the endpoint rejects falls back to high, and stays there', async () => {
  const efforts: unknown[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    efforts.push(body.reasoning_effort);
    if (body.reasoning_effort === 'max') return refusal('Upstream request failed: [400] Invalid request parameters');
    return jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
  }) as unknown as typeof fetch;
  const provider = new OpenAICompatProvider({ baseUrl: 'https://example.test/v1' });
  const options = { model: 'mimo', effort: 'max' as const, reasoning: 'on' as const };
  expect((await provider.complete([{ role: 'user', content: 'hi', timestamp: 0 }], options)).content).toBe('ok');
  await provider.complete([{ role: 'user', content: 'hi', timestamp: 0 }], options);
  expect(efforts).toEqual(['max', 'high', 'high']);
});
