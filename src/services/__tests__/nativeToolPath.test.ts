import { test, expect, afterEach } from 'bun:test';
import path from 'node:path';
import { LLMFactory } from '../LLMProvider.js';
import { ToolService } from '../ToolService.js';

const projectRoot = path.resolve(import.meta.dirname, '../../..');
const realFetch = globalThis.fetch;
let bodies: any[] = [];

const stubFetch = (script: unknown[]) => {
  bodies = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    // The Ollama client asks for the model's context length once; that is not a turn.
    if (String(url).endsWith('/api/show')) return new Response('{}', { status: 404 });
    bodies.push(JSON.parse(init.body));
    const payload = script[Math.min(bodies.length - 1, script.length - 1)];
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

const toolDefs = [
  {
    type: 'function' as const,
    function: {
      name: 'list_files',
      description: 'List project files',
      parameters: { type: 'object', properties: { pattern: { type: 'string' } } },
    },
  },
];

test('a tool-requiring prompt round-trips through dispatch and a second turn', async () => {
  stubFetch([
    {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'list_files', arguments: { pattern: 'package.json' } } }],
      },
      prompt_eval_count: 10,
      eval_count: 4,
    },
    {
      message: { role: 'assistant', content: 'package.json is the manifest.' },
      prompt_eval_count: 20,
      eval_count: 6,
      done: true,
    },
  ]);

  const provider = LLMFactory.createProvider('ollama', { endpoint: 'http://localhost:11434' });
  const toolService = new ToolService({ projectRoot });
  const providerMessages: any[] = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'List package.json for me.' },
  ];

  const first = await provider.complete(providerMessages, { model: 'test', tools: toolDefs });
  const call = first.toolCalls?.[0];
  expect(call?.name).toBe('list_files');
  expect(call?.arguments).toEqual({ pattern: 'package.json' });

  const result = await toolService.execute({ tool: 'list_files', params: call?.arguments ?? {} });
  expect(typeof result.output).toBe('string');
  expect(result.output).toContain('package.json');

  const callId = call?.id ?? 'tool_call_0_0';
  providerMessages.push({
    role: 'assistant',
    content: first.content || '',
    tool_calls: [
      {
        id: callId,
        type: 'function',
        function: { name: call?.name, arguments: JSON.stringify(call?.arguments ?? {}) },
      },
    ],
  });
  providerMessages.push({ role: 'tool', tool_call_id: callId, content: result.output });

  const second = await provider.complete(providerMessages, { model: 'test', tools: toolDefs });
  expect(second.content).toBe('package.json is the manifest.');

  const sent = bodies[1].messages;
  const assistantWithCalls = sent.find((m: any) => m.tool_calls);
  const toolResult = sent.find((m: any) => m.role === 'tool');
  expect(assistantWithCalls?.tool_calls?.[0]?.function?.name).toBe('list_files');
  expect(toolResult?.tool_call_id).toBeTruthy();
  expect(toolResult?.content).toContain('package.json');

  const transcript = JSON.stringify(providerMessages);
  expect(transcript).not.toContain('```json');
});

test('tool shape survives the openrouter message mapping on the way in', async () => {
  stubFetch([
    {
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'call_9', function: { name: 'list_files', arguments: '{"pattern":"package.json"}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    },
    {
      choices: [{ message: { role: 'assistant', content: 'Done.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
    },
  ]);

  const provider = LLMFactory.createProvider('openrouter', { api_key: 'test-key' });
  const providerMessages: any[] = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'List package.json for me.' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call_9', type: 'function', function: { name: 'list_files', arguments: '{"pattern":"package.json"}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'call_9', content: '1. package.json' },
  ];

  const completion = await provider.complete(providerMessages, { model: 'test', tools: toolDefs });
  expect(completion.toolCalls?.[0]?.name).toBe('list_files');
  expect(completion.toolCalls?.[0]?.id).toBe('call_9');

  const sent = bodies[0].messages;
  expect(sent.find((m: any) => m.role === 'assistant')?.tool_calls?.[0]?.id).toBe('call_9');
  expect(sent.find((m: any) => m.role === 'tool')?.tool_call_id).toBe('call_9');
  expect(JSON.stringify(providerMessages)).not.toContain('```json');
});
