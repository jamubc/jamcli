import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startFakeProvider, type FakeProviderServer } from '../../testing/fakeProvider.js';
import { readTranscript, sessionFileFor } from '../../core/transcript/index.js';

const ENTRY = path.join(import.meta.dir, '../../index.tsx');

let server: FakeProviderServer;
let root: string;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-wakes-')));
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, active_profile: 'default' }));
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_provider: 'ollama', preferred_model: 'fake-model' }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** The real command line in a child process, every run sharing one state directory, and so one flag board and session index. */
const jam = (args: string[]) => {
  const child = Bun.spawn(['bun', ENTRY, ...args, '--cwd', root], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, JAMCLI_STATE_DIR: path.join(root, '.state') } });
  return Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]).then(([out, err, code]) => ({ out, err, code }));
};
const result = (out: string) => JSON.parse(out.trim().split('\n').at(-1)!);
const lastPrompt = () => {
  const messages = server.completions().at(-1)!.body.messages;
  return String(messages.at(-1).content);
};

test('a timer the model sets runs as a turn of the same headless run, which ends once none is pending', async () => {
  server.enqueue(
    { toolCalls: [{ id: 'w', name: 'wake', arguments: { action: 'set', after_seconds: 1, prompt: 'Say that the timer went off.' } }] },
    { text: 'I set a timer.' },
    { text: 'The timer went off.' }
  );
  const { out, code, err } = await jam(['-p', 'remind me in a second', '--output-format', 'json']);
  expect(err).not.toContain('Error');
  expect(code).toBe(0);
  const run = result(out);
  expect(run.response).toBe('I set a timer.\n\nThe timer went off.');
  expect(lastPrompt()).toStartWith('[Wake w1 went off: its timer ran out. The model set it');
  expect(lastPrompt()).toContain('Say that the timer went off.');
  const wakes = readTranscript(sessionFileFor(root, run.session_id)).flatMap((event) => (event.type === 'wake' ? [event.action] : []));
  expect(wakes).toEqual(['set', 'fire']);
});

test('a wait on a named session\'s flag, in another process, starts when that session raises it', async () => {
  expect((await jam(['-p', '/rename builder'])).code).toBe(0);
  server.enqueue({ text: 'Compiled the notes.' });
  const waiting = jam(['-p', '/wake when builder raise green: compile the notes', '--output-format', 'json']);
  // Past the process's start and its first checks.
  await Bun.sleep(1_000);
  // Nothing has been asked of the model while the flag is down.
  expect(server.pending()).toBe(1);
  expect((await jam(['-p', '/flag green', '--resume', 'builder'])).code).toBe(0);
  const { out, code } = await waiting;
  expect(code).toBe(0);
  expect(result(out).response).toBe('Compiled the notes.');
  expect(lastPrompt()).toMatch(/^\[Wake w1 went off: \S+ has raised green\. The person set it/);
});
