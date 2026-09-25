import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LspManager } from '../manager.js';
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
    expect((await run({ operation: 'diagnostics', path: '../outside.fk' })).status).toBe('error');
    expect((await run({ operation: 'diagnostics', path: 'notes.txt' })).output).toContain('No language server handles .txt files here.');
  } finally {
    await manager.close();
  }
}, 20_000);

test('after an edit, the model reads the errors the language server finds, and a server that is not installed is not offered', async () => {
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: provider.ollamaBaseUrl } }, active_profile: 'default', trust: { enabled: false }, sandbox: { enabled: false }, lsp: { servers: { fake, missing: { command: 'no-such-language-server', extensions: ['zz'] } } } })
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
