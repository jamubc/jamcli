import { test, expect } from 'bun:test';
import { CoreAgent } from '../agent.js';
import { createSession } from '../state.js';
import type { ChatProvider, CompletionResult, StreamChunk } from '../providers/types.js';
import type { ToolDispatcher } from '../tools/dispatch.js';
import type { AgentEvent, ToolResult } from '../types.js';

test('the loop skeleton runs a turn and emits a text event', async () => {
  const agent = new CoreAgent();
  const session = createSession('/tmp/test-project');
  const events: AgentEvent[] = [];
  const result = await agent.run(session, 'hello', (e) => events.push(e));
  expect(result.status).toBe('ok');
  expect(result.sessionId).toBe(session.id);
  expect(result.turns).toBe(1);
  expect(result.response).toBe('hello');
  expect(events).toEqual([{ type: 'text', delta: 'hello' }]);
});

test('the core streams a provider reply with reasoning and usage', async () => {
  const chunks: StreamChunk[] = [
    { content: 'hel', done: false },
    { content: 'lo', done: false, reasoning: 'greet' },
    {
      content: '',
      done: true,
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    },
  ];
  const provider: ChatProvider = {
    async *streamChat() {
      yield* chunks;
    },
    async complete(): Promise<CompletionResult> {
      return { content: '', usage: undefined };
    },
  };
  const agent = new CoreAgent({ provider, model: 'test-model', modelUsageKey: 'test:test-model' });
  const session = createSession('/tmp/test-project');
  const events: AgentEvent[] = [];
  const result = await agent.run(session, 'hello', (e) => events.push(e));
  expect(result.status).toBe('ok');
  expect(result.response).toBe('hello');
  expect(result.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
  expect(events).toEqual([
    { type: 'text', delta: 'hel' },
    { type: 'text', delta: 'lo' },
    { type: 'reasoning', delta: 'greet' },
    { type: 'usage', usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
  ]);
});
test('the core dispatches a tool call, appends results, and loops', async () => {
  const script: CompletionResult[] = [
    {
      content: '',
      toolCalls: [{ function: { name: 'list_files', arguments: { pattern: 'package.json' } } }],
    },
    { content: 'package.json is the manifest.' },
  ];
  let calls = 0;
  const provider: ChatProvider = {
    async *streamChat() {},
    async complete(): Promise<CompletionResult> {
      return script[Math.min(calls++, script.length - 1)];
    },
  };
  const seen: string[] = [];
  const dispatcher: ToolDispatcher = {
    listTools: () => [{ name: 'list_files', parameters: { type: 'object', properties: {} } }],
    requiresApproval: () => false,
    async execute(call): Promise<ToolResult> {
      seen.push(call.name);
      return { tool: call.name, success: true, output: '1. package.json', durationMs: 1 };
    },
  };
  const agent = new CoreAgent({
    provider,
    dispatcher,
    toolDefinitions: [
      { type: 'function', function: { name: 'list_files', parameters: { type: 'object', properties: {} } } },
    ],
  });
  const events: AgentEvent[] = [];
  const result = await agent.run(createSession('/tmp/test-project'), 'List package.json.', (e) => events.push(e));
  expect(result.status).toBe('ok');
  expect(result.response).toBe('package.json is the manifest.');
  expect(seen).toEqual(['list_files']);
  expect(events.map((e) => e.type)).toEqual(['tool_call', 'tool_result', 'text']);
  const callEvent = events[0];
  const resultEvent = events[1];
  if (callEvent.type !== 'tool_call' || resultEvent.type !== 'tool_result') {
    throw new Error('expected tool_call then tool_result');
  }
  expect(callEvent.call.name).toBe('list_files');
  expect(resultEvent.result.output).toBe('1. package.json');
});

test('an unusable tool call becomes a tool error and the turn continues', async () => {
  const script: CompletionResult[] = [
    { content: '', toolCalls: [{ function: {} } as any] },
    { content: 'Recovered without dispatch.' },
  ];
  let calls = 0;
  const provider: ChatProvider = {
    async *streamChat() {},
    async complete(): Promise<CompletionResult> {
      return script[Math.min(calls++, script.length - 1)];
    },
  };
  let executed = 0;
  const dispatcher: ToolDispatcher = {
    listTools: () => [{ name: 'list_files' }],
    requiresApproval: () => false,
    async execute(call): Promise<ToolResult> {
      executed += 1;
      return { tool: call.name, success: true, output: 'x', durationMs: 0 };
    },
  };
  const agent = new CoreAgent({
    provider,
    dispatcher,
    toolDefinitions: [{ type: 'function', function: { name: 'list_files' } }],
  });
  const events: AgentEvent[] = [];
  const result = await agent.run(createSession('/tmp/test-project'), 'Go.', (e) => events.push(e));
  expect(result.status).toBe('ok');
  expect(result.response).toBe('Recovered without dispatch.');
  expect(executed).toBe(0);
  const errors = events.filter((e) => e.type === 'tool_result' && !(e as any).result.success);
  expect(errors).toHaveLength(1);
});
test('an approval approval runs the tool and a rejection refuses the run', async () => {
  const scripted = () => {
    const script: CompletionResult[] = [
      {
        content: '',
        toolCalls: [{ function: { name: 'run_command', arguments: { command: 'ls' } } }],
      },
      { content: 'final' },
    ];
    let calls = 0;
    const provider: ChatProvider = {
      async *streamChat() {},
      async complete(): Promise<CompletionResult> {
        return script[Math.min(calls++, script.length - 1)];
      },
    };
    let executed = 0;
    const dispatcher: ToolDispatcher = {
      listTools: () => [{ name: 'run_command' }],
      requiresApproval: () => true,
      async execute(call): Promise<ToolResult> {
        executed += 1;
        return { tool: call.name, success: true, output: 'listed', durationMs: 0 };
      },
    };
    const agent = new CoreAgent({
      provider,
      dispatcher,
      toolDefinitions: [{ type: 'function', function: { name: 'run_command' } }],
    });
    return { agent, getExecuted: () => executed };
  };

  {
    const { agent, getExecuted } = scripted();
    const events: AgentEvent[] = [];
    const pending = agent.run(createSession('/tmp/test-project'), 'Run ls.', (e) => {
      events.push(e);
      if (e.type === 'approval_request') e.decide(true);
    });
    const result = await pending;
    expect(result.status).toBe('ok');
    expect(result.response).toBe('final');
    expect(getExecuted()).toBe(1);
    expect(events.map((e) => e.type)).toEqual(['tool_call', 'approval_request', 'tool_result', 'text']);
  }

  {
    const { agent, getExecuted } = scripted();
    const events: AgentEvent[] = [];
    const pending = agent.run(createSession('/tmp/test-project'), 'Run ls.', (e) => {
      events.push(e);
      if (e.type === 'approval_request') e.decide(false);
    });
    const result = await pending;
    expect(result.status).toBe('refused');
    expect(getExecuted()).toBe(0);
    expect(events.map((e) => e.type)).toEqual(['tool_call', 'approval_request']);
  }
});
test('budget exhaustion stops the loop without a second provider call', async () => {
  let completions = 0;
  const provider: ChatProvider = {
    async *streamChat() {},
    async complete(): Promise<CompletionResult> {
      completions += 1;
      return {
        content: '',
        toolCalls: [
          { function: { name: 'list_files', arguments: {} } },
          { function: { name: 'list_files', arguments: {} } },
        ],
      };
    },
  };
  const dispatcher: ToolDispatcher = {
    listTools: () => [{ name: 'list_files' }],
    requiresApproval: () => false,
    async execute(call): Promise<ToolResult> {
      return { tool: call.name, success: true, output: 'x', durationMs: 0 };
    },
  };
  const agent = new CoreAgent({
    provider,
    dispatcher,
    toolDefinitions: [{ type: 'function', function: { name: 'list_files' } }],
    maxToolCallsPerTurn: 1,
  });
  const events: AgentEvent[] = [];
  const result = await agent.run(createSession('/tmp/test-project'), 'List.', (e) => events.push(e));
  expect(result.status).toBe('limit');
  expect(completions).toBe(1);
  expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(1);
});
test('cancel stops a queued run and leaves the session usable', async () => {
  const agent = new CoreAgent();
  const session = createSession('/tmp/test-project');
  agent.cancel(session.id);
  const events: AgentEvent[] = [];
  const cancelled = await agent.run(session, 'hello', (e) => events.push(e));
  expect(cancelled.status).toBe('cancelled');
  expect(events).toEqual([]);
  const again = await agent.run(session, 'hello', (e) => events.push(e));
  expect(again.status).toBe('ok');
});
