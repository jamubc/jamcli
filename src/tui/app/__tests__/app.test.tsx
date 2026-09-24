/** @jsxImportSource @opentui/react */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { testRender } from '@opentui/react/test-utils';
import { App } from '../App.js';
import { createRuntime, type Runtime } from '../../../core/runtime/index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';

let server: FakeProviderServer;
let root: string;
const shared = process.env.JAMCLI_CONFIG_DIR;

beforeEach(() => {
  server = startFakeProvider();
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-app-')));
  root = path.join(base, 'project');
  fs.mkdirSync(root);
  process.env.JAMCLI_CONFIG_DIR = path.join(base, 'user');
  fs.mkdirSync(process.env.JAMCLI_CONFIG_DIR);
  fs.writeFileSync(
    path.join(process.env.JAMCLI_CONFIG_DIR, 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, model: 'ollama:fake-model', sandbox: { enabled: false } })
  );
});
afterEach(() => {
  server.close();
  process.env.JAMCLI_CONFIG_DIR = shared;
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

type Setup = Awaited<ReturnType<typeof testRender>>;

/**
 * The frame once it matches. The renderer's own waits stop when it has nothing
 * scheduled, but a turn's work arrives from the network and a lone Escape from a timer,
 * so this renders and looks again in real time.
 */
async function frameWith(setup: Setup, match: (frame: string) => boolean, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let frame = '';
  while (Date.now() < deadline) {
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    if (match(frame)) return frame;
    await Bun.sleep(10);
  }
  throw new Error(`No matching frame within ${timeoutMs} ms. The last:\n${frame}`);
}

async function mount(runtime: Runtime, onExit = () => undefined) {
  const setup = await testRender(<App runtime={runtime} projectRoot={root} onExit={onExit} />, { width: 100, height: 24, exitOnCtrlC: false });
  await setup.renderOnce();
  return setup;
}

test('a message typed and sent runs a turn, and the reply and status line are shown', async () => {
  const runtime = await createRuntime({ projectRoot: root, surface: 'tui', mcp: false, env: {} });
  const setup = await mount(runtime);
  try {
    const first = await frameWith(setup, (frame) => frame.includes('default mode'));
    expect(first).toContain('ollama:fake-model');
    expect(first).toContain(`session ${runtime.sessionId}`);
    expect(first).toContain('no sandbox');
    expect(first).toContain('ready');

    server.enqueue({ text: 'Hello from the model.', usage: { prompt: 120, completion: 8 } });
    await setup.mockInput.typeText('hi there');
    setup.mockInput.pressEnter();
    const frame = await frameWith(setup, (value) => value.includes('Hello from the model.'));
    expect(frame).toContain('> hi there');
    await frameWith(setup, (value) => value.includes('120 in, 8 out'));
    // After the turn the status line reads the runtime again: the context has grown.
    const usage = runtime.contextUsage();
    await frameWith(setup, (value) => value.includes(`context ${Math.round((usage.used / usage.budget) * 100)}%`));
    expect(server.completions().at(-1)!.body.messages.at(-1).content).toBe('hi there');
  } finally {
    setup.renderer.destroy();
    await runtime.close();
  }
}, 20_000);

test('a call that asks shows the permission prompt, and Escape denies it', async () => {
  const runtime = await createRuntime({ projectRoot: root, surface: 'tui', mcp: false, env: {} });
  const setup = await mount(runtime);
  try {
    server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'echo hello' } }] });
    await setup.mockInput.typeText('say hello');
    setup.mockInput.pressEnter();
    const prompt = await frameWith(setup, (value) => value.includes('Allow run_command echo hello?'));
    expect(prompt).toContain('1 allow once');
    expect(prompt).toContain('Asked because default mode asks before tools that run commands.');
    setup.mockInput.pressEscape();
    // A person's no, without feedback, ends the turn, and the interface says so.
    const after = await frameWith(setup, (value) => value.includes('Stopped because a tool call was denied.'));
    expect(after).toContain('denied: run_command echo hello');
    expect(after).toContain('(denied by you)');
    expect(after).not.toContain('Allow run_command');
  } finally {
    setup.renderer.destroy();
    await runtime.close();
  }
}, 20_000);

test('1 allows a call once; Shift+Tab changes the mode; Ctrl+C twice asks to leave', async () => {
  const runtime = await createRuntime({ projectRoot: root, surface: 'tui', mcp: false, env: {} });
  let exited = 0;
  const setup = await mount(runtime, () => void (exited += 1));
  try {
    server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'echo allowed-output' } }] }, { text: 'It printed.' });
    await setup.mockInput.typeText('run it');
    setup.mockInput.pressEnter();
    await frameWith(setup, (value) => value.includes('Allow run_command'));
    setup.mockInput.pressKey('1');
    const after = await frameWith(setup, (value) => value.includes('It printed.'));
    expect(after).toMatch(/done: run_command echo allowed-output, \d+ ms \(allowed by you\)/);

    setup.mockInput.pressTab({ shift: true });
    expect(await frameWith(setup, (value) => value.includes('accept-edits mode'))).toContain('accept-edits mode');
    expect(runtime.permissionMode).toBe('accept-edits');

    setup.mockInput.pressCtrlC();
    await frameWith(setup, (value) => value.includes('Press Ctrl+C again to exit.'));
    expect(exited).toBe(0);
    setup.mockInput.pressCtrlC();
    await setup.renderOnce();
    expect(exited).toBe(1);
  } finally {
    setup.renderer.destroy();
    await runtime.close();
  }
}, 20_000);

test('replies render as Markdown, and an edit shows its diff in the prompt and in its block', async () => {
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\nthree\n');
  const runtime = await createRuntime({ projectRoot: root, surface: 'tui', mcp: false, env: {} });
  const setup = await mount(runtime);
  try {
    server.enqueue({ text: '**Bold words** and a list:\n\n- first item\n- second item\n\n```ts\nconst answer = 42\n```' });
    await setup.mockInput.typeText('format something');
    setup.mockInput.pressEnter();
    const reply = await frameWith(setup, (value) => value.includes('const answer = 42') && value.includes('second item'));
    // The Markdown markers are hidden; the words stay.
    expect(reply).toContain('Bold words');
    expect(reply).not.toContain('**Bold words**');

    server.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'two', replace_string: 'TWO' } }] }, { text: 'Changed it.' });
    await setup.mockInput.typeText('change two');
    setup.mockInput.pressEnter();
    const prompt = await frameWith(setup, (value) => value.includes('Allow edit a.txt?'));
    expect(prompt).toMatch(/-\s*two/);
    expect(prompt).toMatch(/\+\s*TWO/);
    setup.mockInput.pressKey('1');
    const after = await frameWith(setup, (value) => value.includes('Changed it.'));
    expect(after).toContain('done: edit a.txt, 1 line added and 1 removed');
    expect(after).toMatch(/\+\s*TWO/);
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('one\nTWO\nthree\n');
  } finally {
    setup.renderer.destroy();
    await runtime.close();
  }
}, 20_000);
