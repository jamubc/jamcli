import { afterEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRedactor } from '../redact.js';
import { CoreAgent } from '../agent.js';
import { createSession } from '../state.js';
import type { AgentEvent } from '../types.js';
import type { ToolDispatcher } from '../tools/dispatch.js';
import { createScriptedProvider } from '../../testing/scriptedProvider.js';
import { SessionLog, TranscriptRecorder } from '../transcript/index.js';

const KEY = 'sk-or-v1-0123456789abcdef';

test('credential values are replaced by a marker naming their source', () => {
  const redact = createRedactor(
    { OPENROUTER_API_KEY: KEY, GITHUB_TOKEN: 'ghp_abcdefghij', DB_PASSWORD_PLAIN: 'hunter2hunter2', HOME: '/home/someone-long' },
    [{ name: 'keychain:anthropic', value: 'sk-ant-zyxwvut987' }]
  );
  expect(redact(`key=${KEY} again ${KEY}`)).toBe('key=[redacted:OPENROUTER_API_KEY] again [redacted:OPENROUTER_API_KEY]');
  expect(redact('token ghp_abcdefghij')).toBe('token [redacted:GITHUB_TOKEN]');
  expect(redact('pw hunter2hunter2')).toBe('pw [redacted:DB_PASSWORD_PLAIN]');
  expect(redact('stored sk-ant-zyxwvut987')).toBe('stored [redacted:keychain:anthropic]');
  expect(redact('home is /home/someone-long')).toBe('home is /home/someone-long');
});

test('short values are left alone, and a secret containing another is replaced whole', () => {
  const redact = createRedactor({ SHORT_TOKEN: 'abc123', INNER_KEY: 'inner-value', OUTER_SECRET: 'prefix-inner-value' });
  expect(redact('abc123')).toBe('abc123');
  expect(redact('prefix-inner-value')).toBe('[redacted:OUTER_SECRET]');
  expect(redact('just inner-value')).toBe('just [redacted:INNER_KEY]');
  expect(createRedactor({})('anything')).toBe('anything');
});

const leakyDispatcher = (): ToolDispatcher => ({
  listTools: () => [],
  requiresApproval: () => false,
  execute: async (call, context) => {
    context?.onProgress?.(`progress ${KEY}\n`);
    return { tool: call.name, success: true, output: `env: OPENROUTER_API_KEY=${KEY}`, durationMs: 0 };
  },
});

let root: string | undefined;
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
  delete process.env.JAMCLI_REDACT_TEST_TOKEN;
});

test('tool output is redacted before the model, the surface, and the log see it', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-redact-'));
  const state = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, 'state');
  try {
    const log = SessionLog.create(root, { surface: 'cli' });
    const recorder = new TranscriptRecorder(log, { surface: 'cli' });
    const provider = createScriptedProvider([{ toolCalls: [{ name: 'run_command', arguments: { command: 'env' } }] }, { text: 'done' }]);
    const events: AgentEvent[] = [];
    await new CoreAgent({
      provider,
      model: 'm',
      dispatcher: leakyDispatcher(),
      toolDefinitions: [{ type: 'function', function: { name: 'run_command' } }],
      redact: createRedactor({ OPENROUTER_API_KEY: KEY }),
    }).run(createSession(root, log.id), 'show env', (event) => {
      events.push(event);
      recorder.handle(event);
    });

    const sent = provider.calls[1].messages.find((m) => m.role === 'tool')?.content;
    expect(sent).toBe('env: OPENROUTER_API_KEY=[redacted:OPENROUTER_API_KEY]');
    const surfaced = JSON.stringify(events.filter((e) => e.type === 'tool_result' || e.type === 'tool_progress'));
    expect(surfaced).toContain('[redacted:OPENROUTER_API_KEY]');
    expect(surfaced).not.toContain(KEY);
    expect(fs.readFileSync(log.file, 'utf8')).not.toContain(KEY);
  } finally {
    if (state === undefined) delete process.env.JAMCLI_STATE_DIR;
    else process.env.JAMCLI_STATE_DIR = state;
  }
});

test('without a redactor the engine redacts the credentials in its environment', async () => {
  process.env.JAMCLI_REDACT_TEST_TOKEN = KEY;
  const provider = createScriptedProvider([{ toolCalls: [{ name: 'run_command', arguments: {} }] }, { text: 'done' }]);
  await new CoreAgent({
    provider,
    model: 'm',
    dispatcher: leakyDispatcher(),
    toolDefinitions: [{ type: 'function', function: { name: 'run_command' } }],
  }).run(createSession('/tmp/redact'), 'go', () => {});
  expect(provider.calls[1].messages.find((m) => m.role === 'tool')?.content).toBe(
    'env: OPENROUTER_API_KEY=[redacted:JAMCLI_REDACT_TEST_TOKEN]'
  );
});
