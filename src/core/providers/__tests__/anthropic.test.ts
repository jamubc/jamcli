import { test, expect, afterEach } from 'bun:test';
import { AnthropicProvider } from '../anthropic.js';

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

test('translates a request to the Anthropic Messages shape', async () => {
  let captured: any;
  globalThis.fetch = (async (url: any, init: any) => {
    captured = { url, body: JSON.parse(init.body), headers: init.headers };
    return jsonResponse({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 2 } });
  }) as unknown as typeof fetch;

  const provider = new AnthropicProvider({ apiKey: 'sk-ant', baseUrl: 'https://api.anthropic.test' });
  const result = await provider.complete(
    [
      { role: 'system', content: 'be nice', timestamp: 0 },
      { role: 'user', content: 'hi', timestamp: 0 },
      {
        role: 'assistant',
        content: '',
        timestamp: 0,
        tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'list_files', arguments: { pattern: '*' } } }],
      },
      { role: 'tool', content: 'a.ts', timestamp: 0, tool_call_id: 'toolu_1' },
    ],
    {
      model: 'claude-x',
      tools: [{ type: 'function', function: { name: 'list_files', description: 'd', parameters: { type: 'object' } } }],
    }
  );

  expect(captured.url).toBe('https://api.anthropic.test/v1/messages');
  expect(captured.headers['x-api-key']).toBe('sk-ant');
  expect(captured.headers['anthropic-version']).toBe('2023-06-01');
  expect(captured.body.system).toEqual([{ type: 'text', text: 'be nice', cache_control: { type: 'ephemeral' } }]);
  expect(captured.body.max_tokens).toBeGreaterThan(0);
  expect(captured.body.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'hi' }] });
  expect(captured.body.messages[1].content[0]).toEqual({
    type: 'tool_use',
    id: 'toolu_1',
    name: 'list_files',
    input: { pattern: '*' },
  });
  expect(captured.body.messages[2].content[0]).toEqual({
    type: 'tool_result',
    tool_use_id: 'toolu_1',
    content: 'a.ts',
    cache_control: { type: 'ephemeral' },
  });
  expect(captured.body.tools[0]).toEqual({
    name: 'list_files',
    description: 'd',
    input_schema: { type: 'object' },
    cache_control: { type: 'ephemeral' },
  });
  expect(result.content).toBe('ok');
  expect(result.usage).toEqual({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
});

test('translates thinking, text, and tool_use streaming events', async () => {
  globalThis.fetch = (async () =>
    streamResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":4}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"ponder"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_2","name":"grep"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\\"x\\"}"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":6}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ])) as unknown as typeof fetch;

  const provider = new AnthropicProvider({ apiKey: 'sk-ant', baseUrl: 'https://api.anthropic.test' });
  const events: any[] = [];
  for await (const chunk of provider.streamChat([{ role: 'user', content: 'hi', timestamp: 0 }], { model: 'claude-x' })) {
    events.push(chunk);
  }

  expect(events.map((event) => [event.reasoning ?? null, event.content, event.done])).toEqual([
    ['ponder', '', false],
    [null, 'Hi', false],
    [null, '', true],
  ]);
  const done = events[events.length - 1];
  expect(done.usage).toEqual({ prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 });
  expect(done.toolCalls).toEqual([
    { id: 'toolu_2', type: 'function', function: { name: 'grep', arguments: { q: 'x' } } },
  ]);
});

test('preserves tool calls and thinking blocks in a non-streaming response', async () => {
  globalThis.fetch = (async () =>
    jsonResponse({
      content: [
        { type: 'thinking', thinking: 'why' },
        { type: 'text', text: 'answer' },
        { type: 'tool_use', id: 'toolu_3', name: 'list_files', input: { pattern: '*.md' } },
      ],
      usage: { input_tokens: 2, output_tokens: 3 },
    })) as unknown as typeof fetch;

  const provider = new AnthropicProvider({ apiKey: 'sk-ant', baseUrl: 'https://api.anthropic.test' });
  const result = await provider.complete([{ role: 'user', content: 'hi', timestamp: 0 }], { model: 'claude-x' });

  expect(result.content).toBe('answer');
  expect(result.reasoning).toBe('why');
  expect(result.toolCalls).toEqual([
    { id: 'toolu_3', type: 'function', function: { name: 'list_files', arguments: { pattern: '*.md' } } },
  ]);
});

test('honors a base URL that already carries the version prefix', async () => {
  let url = '';
  globalThis.fetch = (async (target: any) => {
    url = String(target);
    return jsonResponse({ content: [{ type: 'text', text: 'ok' }] });
  }) as unknown as typeof fetch;

  const provider = new AnthropicProvider({ apiKey: 'sk-ant', baseUrl: 'https://api.anthropic.test/v1' });
  await provider.complete([{ role: 'user', content: 'hi', timestamp: 0 }], { model: 'claude-x' });

  expect(url).toBe('https://api.anthropic.test/v1/messages');
});
