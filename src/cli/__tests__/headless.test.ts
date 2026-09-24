import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startFakeProvider, type FakeProviderServer } from '../../testing/fakeProvider.js';
import { SessionLog } from '../../core/transcript/index.js';

const ENTRY = path.join(import.meta.dir, '../../index.tsx');

let server: FakeProviderServer;
let root: string;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-headless-'));
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, active_profile: 'default' })
  );
  fs.writeFileSync(
    path.join(root, '.jamcli', 'profiles', 'default.json'),
    JSON.stringify({ name: 'Default', preferred_provider: 'ollama', preferred_model: 'fake-model' })
  );
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** Run the real command line in a child process; the fake server keeps serving meanwhile. */
const jam = (args: string[], options: { onStart?: (child: Bun.Subprocess) => void } = {}) => {
  const child = Bun.spawn(['bun', ENTRY, ...args, '--cwd', root], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, JAMCLI_STATE_DIR: path.join(root, '.state') },
  });
  options.onStart?.(child);
  return Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]).then(([out, err, code]) => ({
    out,
    err,
    code,
  }));
};

const lastLine = (text: string) => JSON.parse(text.trim().split('\n').at(-1)!);

test('jamcli -p edits a file with --allow-tool edit and reports it as JSON', async () => {
  server.enqueue(
    { toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } }] },
    { text: 'Changed it.' }
  );
  const { out, code } = await jam(['-p', 'update @a.txt', '--allow-tool', 'edit', '--output-format', 'json']);
  expect(code).toBe(0);
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('new\n');
  const result = lastLine(out);
  expect(result).toMatchObject({ type: 'result', status: 'ok', response: 'Changed it.', provider: 'ollama', model: 'fake-model', permission_denials: [] });

  const request = server.completions().at(-2)!.body;
  const offered = request.tools.map((tool: any) => tool.function.name);
  for (const name of ['edit', 'write_file', 'run_command', 'apply_patch']) expect(offered).toContain(name);
  expect(request.tools.find((tool: any) => tool.function.name === 'edit').function.parameters.required).toContain('path');
  expect(request.messages.find((message: any) => message.role === 'user').content).toContain('File a.txt');

  const approval = SessionLog.open(root, result.session_id).events().find((event) => event.type === 'approval');
  expect(approval).toMatchObject({ by: 'flag', rule: 'edit', surface: 'headless' });
});

test('jamcli -p runs a command with --allow-tool run_command and streams its output (F10)', async () => {
  server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'echo from-the-shell' } }] }, { text: 'Ran it.' });
  const { out, code } = await jam(['-p', 'run it', '--allow-tool', 'run_command', '--output-format', 'stream-json']);
  expect(code).toBe(0);
  const lines = out.trim().split('\n').map((line) => JSON.parse(line));
  const result = lines.find((line) => line.type === 'tool_result');
  expect(result).toMatchObject({ id: 'c1', tool: 'run_command', status: 'ok', success: true });
  expect(result.output).toContain('from-the-shell');
  expect(lines.find((line) => line.type === 'approval_decision')).toMatchObject({ allow: true, by: 'flag' });
  expect(lines.at(-1)).toMatchObject({ type: 'result', status: 'ok' });
});

test('a call that would ask is not made, the model is told why, and the run carries on', async () => {
  server.enqueue(
    { toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } }] },
    { text: 'I could not edit it.' }
  );
  const { out, code } = await jam(['-p', 'update a.txt', '--output-format', 'json']);
  expect(code).toBe(0);
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('old\n');
  const result = lastLine(out);
  expect(result.response).toBe('I could not edit it.');
  expect(result.permission_denials).toEqual([
    {
      tool: 'edit',
      call_id: 'e1',
      arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' },
      reason: 'default mode asks before tools that change files',
    },
  ]);
  const told = server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool');
  expect(told.content).toContain('--allow-tool edit');
  const approval = SessionLog.open(root, result.session_id).events().find((event) => event.type === 'approval');
  expect(approval).toMatchObject({ allow: false, by: 'mode', surface: 'headless' });
});

test('--resume and --continue carry the earlier tool calls into the next request', async () => {
  server.enqueue({ toolCalls: [{ id: 'g1', name: 'glob', arguments: { pattern: '*.txt' } }] }, { text: 'Found a.txt.' });
  const first = lastLine((await jam(['-p', 'list text files', '--output-format', 'json'])).out);

  server.enqueue({ text: 'Still a.txt.' });
  const resumed = await jam(['-p', 'and now?', '--resume', first.session_id, '--output-format', 'json']);
  expect(lastLine(resumed.out).session_id).toBe(first.session_id);
  const messages = server.completions().at(-1)!.body.messages;
  expect(messages.map((message: any) => message.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
  expect(messages[2].tool_calls[0].function.name).toBe('glob');

  server.enqueue({ text: 'Yes.' });
  const continued = await jam(['-p', 'sure?', '--continue', '--output-format', 'json']);
  expect(lastLine(continued.out).session_id).toBe(first.session_id);
  expect(server.completions().at(-1)!.body.messages).toHaveLength(8);
});

test('a provider error is reported with its message and exit code 1', async () => {
  server.enqueue({ status: 400, errorBody: { error: 'model "fake-model" is not loaded' } });
  const { out, code } = await jam(['-p', 'hi', '--output-format', 'json']);
  expect(code).toBe(1);
  const result = lastLine(out);
  expect(result.status).toBe('error');
  expect(result.error).toContain('is not loaded');
});

test('text output keeps stdout for the answer and reports notices on stderr', async () => {
  server.enqueue({ text: 'Answer.' });
  const { out, err, code } = await jam(['-p', 'hi', '--allow-tool', 'edt']);
  expect(code).toBe(0);
  expect(out).toBe('Answer.\n');
  expect(err).toContain('warn: The rule edt (--allow-tool edt) names no tool');
  const missing = await jam(['-p', 'hi', '--resume', 'no-such-session']);
  expect(missing.code).toBe(1);
  expect(missing.err).toContain('No session named no-such-session');
});

test('an interrupt cancels the turn, reports it, and exits with 130', async () => {
  server.enqueue({ text: 'too late', delayMs: 10_000 });
  const before = server.completions().length;
  const { out, code } = await jam(['-p', 'slow', '--output-format', 'json'], {
    onStart: (child) => {
      const poll = setInterval(() => {
        if (server.completions().length > before) {
          clearInterval(poll);
          child.kill('SIGINT');
        }
      }, 20);
    },
  });
  expect(code).toBe(130);
  expect(lastLine(out).status).toBe('cancelled');
});

test('--dry-run makes no change and reports each call that would have made one', async () => {
  server.enqueue(
    {
      toolCalls: [
        { id: 'r1', name: 'read_file', arguments: { path: 'a.txt' } },
        { id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } },
        { id: 'c1', name: 'run_command', arguments: { command: 'touch made.txt' } },
      ],
    },
    { text: 'That is the plan.' }
  );
  const { out, code } = await jam(['-p', 'fix it', '--dry-run', '--output-format', 'json']);
  expect(code).toBe(0);
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('old\n');
  expect(fs.existsSync(path.join(root, 'made.txt'))).toBe(false);
  const result = lastLine(out);
  expect(result.dry_run.map((entry: any) => [entry.tool, entry.call_id, entry.summary])).toEqual([
    ['edit', 'e1', 'edit a.txt'],
    ['run_command', 'c1', 'run_command touch made.txt'],
  ]);
  expect(result.dry_run[0].preview.kind).toBe('diff');
  expect(result.dry_run[0].preview.text).toContain('+new');
  expect(result.permission_denials).toEqual([]);
  const results = server.completions().at(-1)!.body.messages.filter((message: any) => message.role === 'tool');
  expect(results[0].content).toContain('old');
  expect(results[1].content).toContain('this is a dry run');
});

test('--dry-run in text prints the report after the answer', async () => {
  server.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } }] }, { text: 'Planned.' });
  const { out } = await jam(['-p', 'fix it', '--dry-run']);
  expect(out).toStartWith('Planned.\n\nDry run: 1 call was not made.\n- edit a.txt\n');
  expect(out).toContain('    +new');
});

test('--permission-mode, --allowed-tools, and --disallowed-tools shape what runs', async () => {
  server.enqueue({ text: 'planning' });
  const plan = lastLine((await jam(['-p', 'plan it', '--permission-mode', 'plan', '--output-format', 'json'])).out);
  expect(plan.permission_mode).toBe('plan');
  expect(server.completions().at(-1)!.body.tools.map((tool: any) => tool.function.name)).not.toContain('edit');

  server.enqueue(
    { toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'echo hi' } }, { id: 'c2', name: 'run_command', arguments: { command: 'echo secret' } }] },
    { text: 'ok' }
  );
  const shaped = lastLine(
    (await jam(['-p', 'run', '--allowed-tools', 'run_command(echo *)', '--disallowed-tools', 'run_command(echo secret*)', '--output-format', 'json'])).out
  );
  expect(shaped.permission_denials).toEqual([]);
  const results = server.completions().at(-1)!.body.messages.filter((message: any) => message.role === 'tool');
  expect(results[0].content).toContain('hi');
  expect(results[1].content).toContain('Not run: run_command(echo secret*) denies it (--disallowed-tools run_command(echo secret*))');
});

test('--dangerously-bypass-permissions runs changes without asking, and a bad mode is reported', async () => {
  server.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } }] }, { text: 'done' });
  const bypass = lastLine((await jam(['-p', 'fix', '--dangerously-bypass-permissions', '--output-format', 'json'])).out);
  expect(bypass.permission_mode).toBe('bypass');
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('new\n');

  server.enqueue({ text: 'ok' });
  const bogus = lastLine((await jam(['-p', 'hi', '--permission-mode', 'yolo', '--output-format', 'json'])).out);
  expect(bogus.permission_mode).toBe('default');
  expect(bogus.notices.map((notice: any) => notice.message)).toContain('--permission-mode "yolo" is not a mode; use plan, default, accept-edits, auto, or bypass.');
});

test('the result and the stream report what the session cost, with an unknown price as null', async () => {
  server.enqueue({ text: 'ok', usage: { prompt: 100, completion: 10 } });
  const local = lastLine((await jam(['-p', 'hi', '--output-format', 'json'])).out);
  expect(local).toMatchObject({
    total_cost_usd: 0,
    unpriced_requests: 0,
    model_usage: { 'ollama:fake-model': { requests: 1, cost_usd: 0, unpriced_requests: 0, prompt_tokens: 100, completion_tokens: 10 } },
  });
  expect(local.delegated).toBeUndefined();

  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({
      api_registry: { ollama: { endpoint: server.ollamaBaseUrl }, openai: { base_url: server.openaiBaseUrl, api_key: 'sk-test-0123456789abcdef' } },
      active_profile: 'default',
      models: { 'openai:priced': { context_window: 100_000, price: { input: 2, output: 8 } } },
    })
  );
  server.enqueue({ text: 'ok', usage: { prompt: 1_000, completion: 100, cacheRead: 400 } });
  const streamed = (await jam(['-p', 'hi', '--model', 'openai:priced', '--output-format', 'stream-json'])).out.trim().split('\n').map((line) => JSON.parse(line));
  // No cache price is configured, so the cached reads are charged as input.
  const expected = (1_000 * 2 + 100 * 8) / 1e6;
  const usage = streamed.find((event) => event.type === 'usage');
  expect(usage).toMatchObject({ model: 'openai:priced', usage: { prompt_tokens: 1_000, cached_tokens: 400 } });
  expect(usage.cost_usd).toBeCloseTo(expected, 12);
  expect(streamed.at(-1).total_cost_usd).toBeCloseTo(expected, 12);
  expect(streamed.at(-1).model_usage['openai:priced']).toMatchObject({ cached_tokens: 400, cache_write_tokens: 0 });

  server.enqueue({ text: 'ok', usage: { prompt: 100, completion: 10 } });
  const unknown = lastLine((await jam(['-p', 'hi', '--model', 'openai:mystery', '--output-format', 'json'])).out);
  expect(unknown).toMatchObject({ total_cost_usd: null, unpriced_requests: 1, model_usage: { 'openai:mystery': { cost_usd: null, unpriced_requests: 1 } } });
});
