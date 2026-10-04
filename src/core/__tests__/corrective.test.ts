import { expect, test } from 'bun:test';
import { CoreAgent, hasDroppedToolCall, narratesIntentWithoutAction } from '../agent.js';
import { createSession } from '../state.js';
import { createScriptedProvider } from '../../testing/scriptedProvider.js';
import type { ToolDispatcher } from '../tools/dispatch.js';
import type { AgentEvent, ToolCall, ToolResult } from '../types.js';

const project = '/tmp/engine-project';

const fakeDispatcher = (options: { log?: string[] } = {}): ToolDispatcher => ({
  listTools: () => [],
  requiresApproval: () => false,
  isReadOnly: (name) => name.startsWith('read'),
  async execute(call: ToolCall): Promise<ToolResult> {
    options.log?.push(call.name);
    return { tool: call.name, success: true, output: `${call.name} result`, durationMs: 1 };
  },
});

const toolDefs = (...names: string[]) => names.map((name) => ({ type: 'function' as const, function: { name } }));

test('hasDroppedToolCall detects pseudo-calls written in text', () => {
  expect(hasDroppedToolCall('<tool_call>{"name": "read_file"}</tool_call>')).toBe(true);
  expect(hasDroppedToolCall('```json\n{"name": "run_command", "arguments": {"command": "ls"}}\n```')).toBe(true);
  expect(hasDroppedToolCall('Action: run_command')).toBe(true);
  expect(hasDroppedToolCall('I inspected the code and found no errors.')).toBe(false);
});

test('narratesIntentWithoutAction detects trailing plans and action narration', () => {
  expect(narratesIntentWithoutAction('Let me now read the file.')).toBe(true);
  expect(narratesIntentWithoutAction("I will now update the configuration.")).toBe(true);
  expect(narratesIntentWithoutAction("I'll now check the test results.")).toBe(true);
  expect(narratesIntentWithoutAction('Next, I will run the build.')).toBe(true);
  expect(narratesIntentWithoutAction('Let me examine the code...')).toBe(true);
  expect(narratesIntentWithoutAction('Here is the explanation of the bug. It was caused by a null pointer.')).toBe(false);
});

test('intent_ack_continuation nudges model when it narrates intent without calling tools', async () => {
  const provider = createScriptedProvider([
    { text: 'I will now inspect the project files.' },
    { text: 'Reading file.', toolCalls: [{ name: 'read_file', arguments: { path: 'a.txt' } }] },
    { text: 'The file contains test content.' },
  ]);

  const agent = new CoreAgent({
    provider,
    model: 'deepseek-chat',
    dispatcher: fakeDispatcher(),
    toolDefinitions: toolDefs('read_file'),
    intentAckContinuation: 'auto',
  });

  const events: AgentEvent[] = [];
  const result = await agent.run(createSession(project), 'find the content', (e) => events.push(e));

  expect(result.status).toBe('ok');
  expect(result.response).toBe('The file contains test content.');
  expect(provider.calls.length).toBe(3);
  expect(provider.calls[1].messages.at(-1)?.content).toContain('[System: Continue now. Execute the required tool calls');
});

test('dropped_call_guards nudges model when markdown tool call is emitted in text', async () => {
  const provider = createScriptedProvider([
    { text: '```json\n{"name": "read_file", "arguments": {"path": "config.json"}}\n```' },
    { text: 'Calling tool.', toolCalls: [{ name: 'read_file', arguments: { path: 'config.json' } }] },
    { text: 'Found configuration.' },
  ]);

  const agent = new CoreAgent({
    provider,
    model: 'claude-3-5-sonnet',
    dispatcher: fakeDispatcher(),
    toolDefinitions: toolDefs('read_file'),
    stallGuards: true,
  });

  const events: AgentEvent[] = [];
  const result = await agent.run(createSession(project), 'read config', (e) => events.push(e));

  expect(result.status).toBe('ok');
  expect(result.response).toBe('Found configuration.');
  expect(provider.calls.length).toBe(3);
  expect(provider.calls[1].messages.at(-1)?.content).toContain('[System: You indicated a tool call in your text');
});

test('intent_ack_continuation caps at max nudges per turn to prevent loops', async () => {
  const provider = createScriptedProvider([
    { text: 'I will now check the file.' },
    { text: 'Let me now check the file again.' },
    { text: 'I will now inspect the directory.' },
  ]);

  const agent = new CoreAgent({
    provider,
    model: 'deepseek-chat',
    dispatcher: fakeDispatcher(),
    toolDefinitions: toolDefs('read_file'),
    intentAckContinuation: true,
  });

  const events: AgentEvent[] = [];
  const result = await agent.run(createSession(project), 'check it', (e) => events.push(e));

  expect(result.status).toBe('ok');
  expect(provider.calls.length).toBe(3);
  expect(result.response).toBe('I will now inspect the directory.');
});

test('stall_guards breaks identical call replay loops and terminates runaway loops', async () => {
  const provider = createScriptedProvider([
    { text: 'step 1', toolCalls: [{ name: 'read_file', arguments: { path: 'repeat.txt' } }] },
    { text: 'step 2', toolCalls: [{ name: 'read_file', arguments: { path: 'repeat.txt' } }] },
    { text: 'step 3', toolCalls: [{ name: 'read_file', arguments: { path: 'repeat.txt' } }] },
    { text: 'step 4', toolCalls: [{ name: 'read_file', arguments: { path: 'repeat.txt' } }] },
  ]);

  const agent = new CoreAgent({
    provider,
    model: 'deepseek-chat',
    dispatcher: fakeDispatcher(),
    toolDefinitions: toolDefs('read_file'),
    stallGuards: true,
    toolLoopGuardrails: true,
  });

  const events: AgentEvent[] = [];
  const result = await agent.run(createSession(project), 'read repeat', (e) => events.push(e));

  expect(result.status).toBe('limit');
  expect(result.response).toContain('Stopped: repeating identical tool call loop detected');

  // Verify that the 3rd call output received the identical call warning
  const toolMessages = result.session?.messages.filter((m) => m.role === 'tool') ?? [];
  expect(toolMessages[2]?.content).toContain('[System: Identical tool call repeated 3 times');
});
