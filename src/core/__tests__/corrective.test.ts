import { expect, test } from 'bun:test';
import { CoreAgent, hasDroppedToolCall, narratesIntentWithoutAction } from '../agent.js';
import { createSession } from '../state.js';
import { createScriptedProvider } from '../../testing/scriptedProvider.js';
import type { ToolDispatcher } from '../tools/dispatch.js';
import type { AgentEvent, ToolCall, ToolResult } from '../types.js';
import { DEFAULT_AGENT_LOOP_CONFIG } from '../../types/config.js';

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

test('hasDroppedToolCall detects a pseudo-call written as the whole reply', () => {
  expect(hasDroppedToolCall('<tool_call>{"name": "read_file"}</tool_call>')).toBe(true);
  expect(hasDroppedToolCall('```json\n{"name": "run_command", "arguments": {"command": "ls"}}\n```')).toBe(true);
  expect(hasDroppedToolCall('Action: run_command')).toBe(true);
  expect(hasDroppedToolCall('I inspected the code and found no errors.')).toBe(false);
});

test('hasDroppedToolCall leaves a reply that explains or answers alone', () => {
  // The markup is part of the explanation, not a call the model failed to make.
  expect(hasDroppedToolCall('The failing line was `Action: run_command` in the fixture, which the analyzer flags.')).toBe(false);
  expect(hasDroppedToolCall('You would call it like this:\n\n```json\n{"name": "read_file", "arguments": {"path": "a.txt"}}\n```\n\nThat is what I ran.')).toBe(false);
  expect(hasDroppedToolCall('Done. I found the bug and fixed it.\n\n```json\n{"name": "edit", "arguments": {"path": "a.ts"}}\n```')).toBe(false);
});

test('an answer with Action: run_command on a line of its own is returned whole', async () => {
  const answer = 'The analyzer flagged one line in the fixture:\nAction: run_command\nThat line is a sample the fixture keeps on purpose, so nothing needs to change.';
  expect(hasDroppedToolCall(answer)).toBe(false);
  const provider = createScriptedProvider([{ text: answer }]);
  const agent = new CoreAgent({
    provider,
    model: 'deepseek-chat',
    dispatcher: fakeDispatcher(),
    toolDefinitions: toolDefs('run_command'),
    stallGuards: true,
  });
  const result = await agent.run(createSession(project), 'why does the analyzer flag it?', () => undefined);

  expect(result.status).toBe('ok');
  expect(result.response).toBe(answer);
  expect(provider.calls.length).toBe(1);
});

test('narratesIntentWithoutAction detects trailing plans and action narration', () => {
  expect(narratesIntentWithoutAction('Let me now read the file')).toBe(true);
  expect(narratesIntentWithoutAction('I will now update the configuration')).toBe(true);
  expect(narratesIntentWithoutAction("I'll now check the test results")).toBe(true);
  expect(narratesIntentWithoutAction('Next, I will run the build.')).toBe(true);
  expect(narratesIntentWithoutAction('Let me examine the code')).toBe(true);
  expect(narratesIntentWithoutAction('Here is the explanation of the bug. It was caused by a null pointer.')).toBe(false);
});

test('narratesIntentWithoutAction leaves a reply that ends by answering alone', () => {
  expect(narratesIntentWithoutAction("I found the bug and fixed it. I'll explain why in a moment.")).toBe(false);
  expect(narratesIntentWithoutAction("Here is the fix. Now let me know what you'd like next.")).toBe(false);
  expect(narratesIntentWithoutAction('I will now update the configuration.\n\nHere is the change I made and why.')).toBe(false);
});

test('no steering setting is on until the person sets one', () => {
  expect(DEFAULT_AGENT_LOOP_CONFIG.tool_use_enforcement).toBe('off');
  expect(DEFAULT_AGENT_LOOP_CONFIG.execution_guidance).toBe('off');
  expect(DEFAULT_AGENT_LOOP_CONFIG.intent_ack_continuation).toBe('off');
  expect('stall_guards' in DEFAULT_AGENT_LOOP_CONFIG).toBe(false);
  expect('tool_loop_guardrails' in DEFAULT_AGENT_LOOP_CONFIG).toBe(false);
});

test('an agent with no steering config never nudges and never stops on a loop', async () => {
  const answer = "I read the file and changed the config. I'll now run the tests.";
  const read = { toolCalls: [{ name: 'read_file', arguments: { path: 'a.txt' } }] };
  const provider = createScriptedProvider([read, read, read, read, { text: answer }]);
  const agent = new CoreAgent({
    provider,
    model: 'deepseek-chat',
    dispatcher: fakeDispatcher(),
    toolDefinitions: toolDefs('read_file'),
  });
  const result = await agent.run(createSession(project), 'check the build', () => undefined);

  expect(result.status).toBe('ok');
  expect(result.response).toBe(answer);
  expect(provider.calls.length).toBe(5);
  expect(result.session?.messages.some((m) => m.role === 'system')).toBe(false);
  expect(result.session?.messages.some((m) => m.content.includes('Identical tool call'))).toBe(false);
});

test('a steering note is the harness speaking, not a message in the person\'s voice', async () => {
  const provider = createScriptedProvider([
    { text: 'Let me now read the file' },
    { text: 'Found it.', toolCalls: [{ name: 'read_file', arguments: { path: 'a.txt' } }] },
    { text: 'The file holds the answer.' },
  ]);
  const agent = new CoreAgent({
    provider,
    model: 'deepseek-chat',
    dispatcher: fakeDispatcher(),
    toolDefinitions: toolDefs('read_file'),
    intentAckContinuation: 'on',
  });
  const result = await agent.run(createSession(project), 'read a.txt', () => undefined);

  expect(result.status).toBe('ok');
  const said = result.session?.messages.filter((m) => m.content.includes('carry on')) ?? [];
  expect(said.length).toBe(1);
  // The harness speaks in its own voice: a system note, not a message in the person's.
  expect(said[0].role).toBe('system');
  expect(said[0].content).toStartWith('[A stall guard asks you to carry on:');
  expect(result.session?.messages.some((m) => m.content.includes('[System:'))).toBe(false);
  expect(result.session?.messages.some((m) => m.role === 'user' && m.content.includes('carry on'))).toBe(false);
});

test('a model reply that quotes a harness note is not itself a note', async () => {
  const quoted = '[A stall guard asks you to carry on: you said what you would do and stopped there.]\n\nThat is the harness quoted back. Here is my answer: the build is green.';
  const provider = createScriptedProvider([{ text: quoted }, { text: 'Still green.' }]);
  const agent = new CoreAgent({
    provider,
    model: 'deepseek-chat',
    dispatcher: fakeDispatcher(),
    toolDefinitions: toolDefs('read_file'),
    intentAckContinuation: 'on',
  });
  const result = await agent.run(createSession(project), 'answer me', () => undefined);

  // The model's words stay the model's: it is the turn's answer, and no harness note is added.
  expect(result.status).toBe('ok');
  expect(provider.calls.length).toBe(1);
  expect(result.session?.messages.some((m) => m.role === 'system')).toBe(false);
  const answer = result.session?.messages.at(-1);
  expect(answer?.role).toBe('assistant');
  expect(answer?.content).toContain('the build is green');

  await agent.run(result.session!, 'and now?', () => undefined);
  expect(provider.calls[1].messages.filter((m) => m.content === quoted).map((m) => m.role)).toEqual(['assistant']);
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
  expect(provider.calls[1].messages.at(-1)?.content).toContain('[A stall guard asks you to carry on:');
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
  expect(provider.calls[1].messages.at(-1)?.content).toContain('[A stall guard asks you to issue the call:');
});

test('with no tools offered, neither guard nudges a reply that would trip it', async () => {
  for (const reply of ['```json\n{"name": "read_file", "arguments": {"path": "a.txt"}}\n```', 'I will now inspect the project files']) {
    const provider = createScriptedProvider([{ text: reply }, { text: 'nudged' }]);
    const agent = new CoreAgent({ provider, model: 'deepseek-chat', stallGuards: true, intentAckContinuation: 'on' });
    const result = await agent.run(createSession(project), 'look', () => undefined);

    expect(result.status).toBe('ok');
    expect(result.response).toBe(reply);
    expect(provider.calls.length).toBe(1);
    expect(result.session?.messages.some((m) => m.role === 'system')).toBe(false);
  }
});

test('intent_ack_continuation caps at max nudges per turn to prevent loops', async () => {
  const provider = createScriptedProvider([
    { text: 'I will now check the file' },
    { text: 'Let me now check the file again' },
    { text: 'I will now inspect the directory' },
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

  // Two nudges, then the third reply is the turn's answer rather than another nudge.
  expect(result.status).toBe('ok');
  expect(provider.calls.length).toBe(3);
  expect(result.response).toBe('I will now inspect the directory');
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
  // The model's own last words are the turn's reply; the reason for stopping is not put in its mouth.
  expect(result.response).toBe('step 4');
  expect(result.error).toContain('Stopped: repeating identical tool call loop detected');
  expect(result.session?.messages.filter((m) => m.content.includes('[A stall guard stopped this turn:')).map((m) => m.role)).toEqual(['system']);

  // The 3rd call output carried the warning to try something else.
  const toolMessages = result.session?.messages.filter((m) => m.role === 'tool') ?? [];
  expect(toolMessages[2]?.content).toContain('[System: Identical tool call repeated 3 times');
});
