import { expect, test } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../tools/registry.js';
import { startFakeProvider } from '../../testing/fakeProvider.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { OllamaProvider } from '../providers/ollama.js';
import { OpenAICompatProvider } from '../providers/openai-compat.js';
import { CoreAgent } from '../agent.js';
import { createSession } from '../state.js';
import { createHookBus } from '../hooks/index.js';
import { createScriptedProvider } from '../../testing/scriptedProvider.js';
import type { ToolDispatcher } from '../tools/dispatch.js';
import { SessionLog, TranscriptRecorder } from '../transcript/index.js';

/**
 * Acceptance checks for the defects recorded in
 * openspec/changes/rehaul-jamcli/audit.md. Each starts as a todo so every checkpoint
 * stays green, and becomes a live test in the task that fixes it, named in parentheses.
 * A todo left here at archive time means the finding is still open.
 */

const pending = () => {};


const echoDispatcher = (ask: string[] = []): ToolDispatcher => ({
  listTools: () => [],
  requiresApproval: (name) => ask.includes(name),
  isReadOnly: (name) => name.startsWith('read'),
  execute: async (call) => ({ tool: call.name, success: true, output: `${call.name} ran`, durationMs: 0 }),
});
const defs = (...names: string[]) => names.map((name) => ({ type: 'function' as const, function: { name } }));

const withProject = async (run: (root: string) => Promise<void>) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jamcli-audit-'));
  const state = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  try {
    await run(root);
  } finally {
    if (state === undefined) delete process.env.JAMCLI_STATE_DIR;
    else process.env.JAMCLI_STATE_DIR = state;
    await fs.remove(root);
  }
};

test.todo('F1: the interface offers the full tool set with Ollama and any wording (2.11, 6.4)', pending);
test.todo('F2: headless and ACP offer write and execute tools from the registry (2.12, 2.13)', pending);
test.todo('F3: headless and ACP advertise real tool schemas (2.12, 2.13)', pending);

test('F4: write_file creates a file under the project root (2.2)', () =>
  withProject(async (root) => {
    const result = await createBuiltinRegistry().execute('write_file', { path: 'hello.txt', content: 'hi\n' }, { projectRoot: root });
    expect(result.success).toBe(true);
    expect(await fs.readFile(path.join(root, 'hello.txt'), 'utf-8')).toBe('hi\n');
  }));

test('F5: edit replacements keep $$, $&, $` and $\' literally (2.3)', () =>
  withProject(async (root) => {
    await fs.writeFile(path.join(root, 'run.sh'), 'echo PID\n');
    const replacement = 'echo "pid=$$ match=$&"';
    await createBuiltinRegistry().execute(
      'edit',
      { path: 'run.sh', find_string: 'echo PID', replace_string: replacement },
      { projectRoot: root }
    );
    expect(await fs.readFile(path.join(root, 'run.sh'), 'utf-8')).toBe(`${replacement}\n`);
  }));

test.todo('F6: an ACP session sends earlier turns with the second prompt (2.13)', pending);
test('F7: tool steps stream, keep text beside calls, and send the system prompt first (2.9)', async () => {
  const provider = createScriptedProvider([{ text: 'Looking.', toolCalls: [{ name: 'read_a', arguments: {} }] }, { text: 'Done.' }]);
  const texts: string[] = [];
  await new CoreAgent({ provider, model: 'm', systemPrompt: 'SYS', dispatcher: echoDispatcher(), toolDefinitions: defs('read_a') }).run(
    createSession('/tmp/audit'),
    'go',
    (e) => {
      if (e.type === 'text') texts.push(e.delta);
    }
  );
  expect(texts.join('')).toBe('Looking.Done.');
  const second = provider.calls[1].messages;
  expect(second[0]).toMatchObject({ role: 'system', content: 'SYS' });
  expect(second.find((m) => m.role === 'assistant')?.content).toBe('Looking.');
});
test('F8: calls after an approval request still run or are answered (2.9)', async () => {
  const provider = createScriptedProvider([
    { toolCalls: [{ name: 'write_a', arguments: {} }, { name: 'read_b', arguments: {} }] },
    { text: 'ok' },
  ]);
  await new CoreAgent({ provider, model: 'm', dispatcher: echoDispatcher(['write_a']), toolDefinitions: defs('write_a', 'read_b') }).run(
    createSession('/tmp/audit'),
    'go',
    (e) => {
      if (e.type === 'approval_request') e.decide(true);
    }
  );
  expect(provider.calls[1].messages.filter((m) => m.role === 'tool').map((m) => m.content)).toEqual(['write_a ran', 'read_b ran']);
});
test('F9: a read-edit-test cycle completes under the default loop limits (2.9)', async () => {
  const names = ['read_a', 'read_b', 'edit', 'run_command', 'read_c', 'edit', 'run_command'];
  const provider = createScriptedProvider([...names.map((name) => ({ toolCalls: [{ name, arguments: {} }] })), { text: 'fixed' }]);
  const result = await new CoreAgent({ provider, model: 'm', dispatcher: echoDispatcher(), toolDefinitions: defs(...new Set(names)) }).run(
    createSession('/tmp/audit'),
    'fix it',
    () => {}
  );
  expect(result.status).toBe('ok');
  expect(result.response).toBe('fixed');
});
test.todo('F10: --allow-tool run_command runs the command headlessly (2.12)', pending);
test('F11: run_command reports exit codes and times out (2.5)', () =>
  withProject(async (root) => {
    const registry = createBuiltinRegistry();
    const failed = await registry.execute('run_command', { command: 'exit 4' }, { projectRoot: root });
    expect(failed.status).toBe('error');
    expect(failed.output).toContain('Exit code 4');
    const slow = await registry.execute('run_command', { command: 'sleep 30', timeout_ms: 200 }, { projectRoot: root });
    expect(slow.status).toBe('timeout');
  }));
test('F12: grep finds a match past the 400th file and honors .gitignore (2.6)', () =>
  withProject(async (root) => {
    for (let i = 0; i < 450; i += 1) await fs.writeFile(path.join(root, `f${String(i).padStart(3, '0')}.txt`), 'x\n');
    await fs.writeFile(path.join(root, 'f449.txt'), 'target\n');
    await fs.writeFile(path.join(root, '.gitignore'), 'secret.txt\n');
    await fs.writeFile(path.join(root, 'secret.txt'), 'target\n');
    for (const backend of ['builtin', 'auto'] as const) {
      const result = await createBuiltinRegistry().execute(
        'grep',
        { pattern: 'target' },
        { projectRoot: root, ignorePatterns: [], searchBackend: backend }
      );
      expect(result.output).toContain('f449.txt:1:target');
      expect(result.output).not.toContain('secret.txt');
    }
  }));
test.todo('F13: ACP uses the configured provider (2.13)', pending);
test('F14: reasoning is not replayed to another provider family (2.8)', async () => {
  const server = startFakeProvider();
  try {
    server.enqueue({ text: 'ok' });
    await new AnthropicProvider({ baseUrl: server.anthropicBaseUrl }).complete(
      [
        { role: 'user', content: 'a', timestamp: 0 },
        { role: 'assistant', content: 'b', reasoning: 'unsigned', providerFamily: 'openai', timestamp: 0 },
        { role: 'user', content: 'c', timestamp: 0 },
      ],
      { model: 'claude-x' }
    );
    expect(JSON.stringify(server.completions()[0].body)).not.toContain('thinking');
  } finally {
    server.close();
  }
});
test('F15: a failed request reports the provider error body, and 429 retries (2.8)', async () => {
  const server = startFakeProvider();
  try {
    const provider = new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl, retryPolicy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5 } });
    server.enqueue({ status: 429 }, { text: 'recovered' });
    expect((await provider.complete([{ role: 'user', content: 'x', timestamp: 0 }], { model: 'm' })).content).toBe('recovered');
    server.enqueue({ status: 400, errorBody: { error: { message: 'model does not exist' } } });
    await expect(provider.complete([{ role: 'user', content: 'x', timestamp: 0 }], { model: 'm' })).rejects.toThrow(
      'returned 400: model does not exist'
    );
  } finally {
    server.close();
  }
});
test.todo('F16: interface turns apply rules, hooks, and the trust gate (2.11, 6.4)', pending);
test('F17: resume restores tool calls and results (2.10)', () =>
  withProject(async (root) => {
    const log = SessionLog.create(root, { surface: 'cli' });
    const recorder = new TranscriptRecorder(log, { surface: 'cli' });
    const first = createScriptedProvider([{ toolCalls: [{ id: 'c1', name: 'read_a', arguments: {} }] }, { text: 'done' }]);
    const options = { model: 'm', dispatcher: echoDispatcher(), toolDefinitions: defs('read_a') };
    await new CoreAgent({ ...options, provider: first }).run(createSession(root, log.id), 'go', recorder.handle);
    const second = createScriptedProvider([{ text: 'ok' }]);
    await new CoreAgent({ ...options, provider: second }).run(SessionLog.open(root, log.id).toSession(), 'again', () => {});
    const request = second.calls[0].messages;
    expect(request.find((m) => m.role === 'assistant')?.tool_calls?.[0]).toMatchObject({ id: 'c1', function: { name: 'read_a' } });
    expect(request.find((m) => m.role === 'tool')).toMatchObject({ tool_call_id: 'c1', content: 'read_a ran' });
  }));
test.todo('F18: a created .jamcli directory ignores itself (5.1)', pending);
test('F19: Ollama requests carry num_ctx (2.8)', async () => {
  const server = startFakeProvider();
  try {
    server.enqueue({ text: 'ok' });
    await new OllamaProvider({ endpoint: server.ollamaBaseUrl }).complete([{ role: 'user', content: 'x', timestamp: 0 }], {
      model: 'fake-model',
    });
    expect(server.completions()[0].body.options.num_ctx).toBeGreaterThan(0);
  } finally {
    server.close();
  }
});
test.todo('F20: compaction never separates a tool call from its result (4.3)', pending);
test.todo('F21: tool output is escaped and bounded in the classifier prompt (2.11)', pending);

test('F22: a symbolic link out of the project is refused (2.4)', () =>
  withProject(async (root) => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'jamcli-audit-outside-'));
    try {
      await fs.writeFile(path.join(outside, 'secret'), 'SECRET');
      await fs.symlink(outside, path.join(root, 'link'));
      const result = await createBuiltinRegistry().execute('read_file', { path: 'link/secret' }, { projectRoot: root });
      expect(result.success).toBe(false);
      expect(result.output).not.toContain('SECRET');
    } finally {
      await fs.remove(outside);
    }
  }));

test.todo('F23: MCP servers do not receive provider keys and run on every surface (2.11, 3.5)', pending);
test.todo('F24: @ references expand on every surface (2.11)', pending);
test('F25: a failing hook is a notice, not assistant text (2.9)', async () => {
  const hooks = createHookBus();
  hooks.on('turn_start', () => {
    throw new Error('boom');
  });
  const texts: string[] = [];
  const notices: string[] = [];
  await new CoreAgent({ provider: createScriptedProvider([{ text: 'answer' }]), model: 'm', hooks }).run(createSession('/tmp/audit'), 'hi', (e) => {
    if (e.type === 'text') texts.push(e.delta);
    if (e.type === 'notice') notices.push(e.message);
  });
  expect(texts.join('')).toBe('answer');
  expect(notices.join(' ')).toContain('boom');
});
