import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../index.js';
import { THINKING_ALLOWANCE } from '../../catalog/index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';

let server: FakeProviderServer;
let root: string;
beforeEach(() => {
  server = startFakeProvider({
    models: [
      { id: 'thinker', contextLength: 32768, capabilities: ['completion', 'tools'] },
      { id: 'plain', contextLength: 32768, capabilities: ['completion', 'tools'] },
    ],
  });
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-answer-')));
  fs.mkdirSync(path.join(root, '.jamcli'));
  // The models block states what the catalog would otherwise learn from the provider later.
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, sandbox: { enabled: false }, models: { 'ollama:thinker': { always_thinks: true } } })
  );
  const git = (...args: string[]) => Bun.spawnSync(['git', ...args], { cwd: root });
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git('add', 'a.txt');
});
afterEach(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

/** The output cap the commit draft asked the model for. */
const draftCap = async (model: string) => {
  const runtime = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false, env: {}, model: `ollama:${model}` });
  try {
    server.enqueue({ text: 'feat: add a' });
    expect(await runtime.draftCommitMessage()).toBe('feat: add a');
    return server.completions().at(-1)!.body.options.num_predict;
  } finally {
    await runtime.close();
  }
};

test('a commit message drafted by a model that thinks leaves it room to think before it answers', async () => {
  expect(await draftCap('plain')).toBe(400);
  expect(await draftCap('thinker')).toBe(400 + THINKING_ALLOWANCE);
});
