import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LspManager } from '../manager.js';
import { LspClient, fileUri } from '../client.js';
import { lspTool } from '../../tools/lsp.js';
import { createRuntime } from '../../runtime/index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';

const FAKE = path.join(import.meta.dir, '../../../testing/fakeLsp.ts');
const fake = { command: process.execPath, args: [FAKE], extensions: ['fk'] };
const env = { PATH: process.env.PATH, HOME: process.env.HOME };

let root: string;
let provider: FakeProviderServer;
let previousState: string | undefined;
beforeAll(() => {
  provider = startFakeProvider();
});
afterAll(() => provider.close());
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-lsp-')));
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  fs.writeFileSync(path.join(root, 'main.fk'), 'function greet() {}\nfunction main() {\n  greet()\n}\n');
});
afterEach(() => {
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
});

test('the manager starts a server for a file it serves and answers every operation through the tool', async () => {
  const manager = new LspManager(root, { servers: { fake } }, env);
  try {
    expect(manager.available).toContain('fake');
    expect(manager.serves('main.fk')).toBe(true);
    expect(manager.serves('notes.txt')).toBe(false);
    const tool = lspTool(manager);
    const run = (args: object) => tool.runner(args as any, { projectRoot: root } as any);
    expect((await run({ operation: 'diagnostics', path: 'main.fk' })).output).toBe('No diagnostics for main.fk.');
    fs.writeFileSync(path.join(root, 'main.fk'), 'function greet() {}\nERROR here\n');
    expect((await run({ operation: 'diagnostics', path: 'main.fk' })).output).toBe('main.fk:2:1 error: found ERROR on line 2 (fake)');
    fs.writeFileSync(path.join(root, 'main.fk'), 'function greet() {}\nfunction main() {\n  greet()\n}\n');
    expect((await run({ operation: 'hover', path: 'main.fk', line: 3, column: 4 })).output).toBe('word greet');
    expect((await run({ operation: 'definition', path: 'main.fk', line: 3, column: 4 })).output).toBe('main.fk:1:10');
    expect((await run({ operation: 'references', path: 'main.fk', line: 3, column: 4 })).output).toBe('main.fk:1:10\nmain.fk:3:3');
    expect((await run({ operation: 'symbols', path: 'main.fk' })).output).toBe('greet:1\nmain:2');
    const escape = await run({ operation: 'diagnostics', path: '../outside.fk' });
    expect(escape.status).toBe('error');
    expect(escape.output).toContain('escapes the project root');
    expect((await run({ operation: 'diagnostics', path: 'notes.txt' })).output).toContain('No language server handles .txt files here.');
  } finally {
    await manager.close();
  }
}, 20_000);

test('after an edit, the model reads the errors the language server finds, and a server that is not installed is not offered', async () => {
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: provider.ollamaBaseUrl } }, active_profile: 'default', trust: { enabled: false }, lsp: { servers: { fake, missing: { command: 'no-such-language-server', extensions: ['zz'] } } } })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  const runtime = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false, env, allowTools: ['edit'] });
  try {
    expect(runtime.tools.map((tool) => tool.name)).toContain('lsp');
    provider.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'main.fk', find_string: '  greet()', replace_string: '  ERROR()' } }] }, { text: 'Fixing it.' });
    await runtime.run('break it');
    const tool = provider.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool');
    expect(tool.content).toContain('The language server reports errors after this change:\nmain.fk:3:3 error: found ERROR on line 3 (fake)');
  } finally {
    await runtime.close();
  }
  const quiet = new LspManager(root, { servers: { missing: { command: 'no-such-language-server', extensions: ['zz'] } } }, { PATH: '' });
  expect(quiet.available).toEqual([]);
}, 20_000);

test.skipIf(!Bun.which('pyright-langserver'))('a real server: pyright reports a type error', async () => {
  fs.writeFileSync(path.join(root, 'bad.py'), 'x: int = "text"\n');
  const manager = new LspManager(root, {}, env);
  try {
    const { diagnostics } = await manager.diagnostics('bad.py', 20_000);
    expect(diagnostics.some((item) => item.severity === 1 && /str|int/i.test(item.message))).toBe(true);
  } finally {
    await manager.close();
  }
}, 40_000);

/** A project configured with the fake language server, for the runtime tests. */
const configure = () => {
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: provider.ollamaBaseUrl } }, active_profile: 'default', trust: { enabled: false }, lsp: { servers: { fake, missing: { command: 'no-such-language-server', extensions: ['zz'] } } } })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
};

test('syncing a file again changes it instead of re-opening it', async () => {
  const client = await LspClient.start({ command: process.execPath, args: [FAKE], env }, root);
  try {
    const file = path.join(root, 'main.fk');
    const first = client.reportCount(file);
    client.sync(file, 'function one() {}\n', 'plaintext');
    await client.diagnosticsFor(file, first, 2_000);
    client.sync(file, 'function two() {}\nERROR\n', 'plaintext');
    const { diagnostics } = await client.diagnosticsFor(file, first + 1, 2_000);
    expect(diagnostics.some((item) => item.message === 'found ERROR on line 2')).toBe(true);
    expect(await client.request<Record<string, number>>('fake/opens', null)).toEqual({ [fileUri(file)]: 1 });
    expect(await client.request<number>('fake/changes', null)).toBe(1);
  } finally {
    await client.stop();
  }
}, 20_000);

test('the client answers workspace/configuration, so a server that waits for it can answer', async () => {
  const client = await LspClient.start({ command: process.execPath, args: [FAKE], env }, root);
  try {
    const file = path.join(root, 'main.fk');
    client.sync(file, fs.readFileSync(file, 'utf8'), 'plaintext');
    const hover: any = await client.request('textDocument/hover', { textDocument: { uri: fileUri(file) }, position: { line: 0, character: 10 } }, 3_000);
    expect(hover.contents.value).toBe('word greet');
    expect(await client.request<unknown[]>('fake/configuration', null)).toEqual([null]);
  } finally {
    await client.stop();
  }
}, 20_000);

test('a server that ignores shutdown is killed', async () => {
  const client = await LspClient.start({ command: process.execPath, args: [FAKE, 'stubborn'], env }, root);
  const started = Date.now();
  await client.stop();
  expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  const deadline = Date.now() + 3_000;
  while (!client.exited && Date.now() < deadline) await Bun.sleep(20);
  expect(client.exited).toBeInstanceOf(Error);
}, 20_000);

test('a server that fails to start once is started again on the next request', async () => {
  const flaky = { command: process.execPath, args: [FAKE, 'fail-once'], extensions: ['fk'] };
  const manager = new LspManager(root, { servers: { flaky } }, env);
  try {
    await expect(manager.diagnostics('main.fk', 3_000)).rejects.toThrow();
    expect(fs.existsSync(path.join(root, '.failed-once'))).toBe(true);
    expect((await manager.diagnostics('main.fk', 3_000)).diagnostics).toEqual([]);
  } finally {
    await manager.close();
  }
}, 20_000);

test('only errors, not warnings, are reported to the model after an edit', async () => {
  configure();
  fs.writeFileSync(path.join(root, 'main.fk'), 'function main() {\n  WARN here\n  ERROR here\n}\n');
  const runtime = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false, env, allowTools: ['edit'] });
  try {
    provider.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'main.fk', find_string: '  WARN here', replace_string: '  WARN stays' } }] }, { text: 'Fixing it.' });
    await runtime.run('break it');
    const tool = provider.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool');
    expect(tool.content).toContain('error: found ERROR on line 3');
    expect(tool.content).not.toContain('found WARN');
  } finally {
    await runtime.close();
  }
}, 20_000);

test('after an apply_patch, the changed files\' errors reach the model', async () => {
  configure();
  const runtime = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false, env, allowTools: ['apply_patch'] });
  try {
    const patch = ['--- a/main.fk', '+++ b/main.fk', '@@ -1,4 +1,4 @@', ' function greet() {}', '-function main() {', '+function main() { // ERROR', '   greet()', ' }', ''].join('\n');
    provider.enqueue({ toolCalls: [{ id: 'p1', name: 'apply_patch', arguments: { patch } }] }, { text: 'Patched.' });
    await runtime.run('break it');
    const tool = provider.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool');
    expect(tool.content).toContain('found ERROR on line 2');
  } finally {
    await runtime.close();
  }
}, 20_000);

test('a long list of diagnostics is capped at 20 for the model', async () => {
  configure();
  const many = ['ERROR first', ...Array.from({ length: 24 }, (_, index) => `ERROR line ${index + 2}`)];
  fs.writeFileSync(path.join(root, 'main.fk'), `${many.join('\n')}\n`);
  const runtime = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false, env, allowTools: ['edit'] });
  try {
    provider.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'main.fk', find_string: 'ERROR first', replace_string: 'ERROR changed' } }] }, { text: 'Fixing it.' });
    await runtime.run('break it');
    const tool = provider.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool');
    expect(tool.content.split(' error: ').length - 1).toBe(20);
  } finally {
    await runtime.close();
  }
}, 20_000);
