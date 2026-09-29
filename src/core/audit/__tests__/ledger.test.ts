import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../../runtime/index.js';
import { renderLedger } from '../ledger.js';
import { projectLedger } from '../../../cli/audit.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';

let server: FakeProviderServer;
let root: string;
let previous: Record<string, string | undefined>;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-ledger-')));
  previous = { state: process.env.JAMCLI_STATE_DIR, config: process.env.JAMCLI_CONFIG_DIR };
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  process.env.JAMCLI_CONFIG_DIR = path.join(root, '.user');
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({
      api_registry: { ollama: { endpoint: server.ollamaBaseUrl } },
      active_profile: 'default',
      sandbox: { enabled: false },
      permissions: { allow: ['edit(src/**)'], deny: ['run_command(rm *)'] },
    })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
});
afterEach(() => {
  process.env.JAMCLI_STATE_DIR = previous.state;
  process.env.JAMCLI_CONFIG_DIR = previous.config;
  if (previous.state === undefined) delete process.env.JAMCLI_STATE_DIR;
  if (previous.config === undefined) delete process.env.JAMCLI_CONFIG_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

test('the ledger lists what a session changed and refused, with the rule, where it came from, and the files', async () => {
  const runtime = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false });
  server.enqueue(
    { toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'src/a.ts', find_string: '1', replace_string: '2' } }] },
    { toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'rm -rf src' } }] },
    { text: 'done' }
  );
  await runtime.run('change a, then clean up');
  await runtime.close();

  const entries = projectLedger(root);
  expect(entries).toMatchObject([
    { session: runtime.sessionId, surface: 'headless', tool: 'edit', target: 'edit src/a.ts', allowed: true, by: 'policy', rule: 'edit(src/**)', source: '.jamcli/config.json permissions.allow[0]', changed: ['src/a.ts'] },
    { tool: 'run_command', target: 'run_command rm -rf src', allowed: false, by: 'policy', rule: 'run_command(rm *)', source: '.jamcli/config.json permissions.deny[0]' },
  ]);
  expect(projectLedger(root, { refused: true }).map((entry) => entry.tool)).toEqual(['run_command']);
  expect(projectLedger(root, { session: 'another' })).toEqual([]);
  expect(projectLedger(root, { since: Date.now() + 60_000 })).toEqual([]);

  const text = renderLedger(entries);
  expect(text).toContain('  allowed  edit src/a.ts  by policy: rule edit(src/**) from .jamcli/config.json permissions.allow[0]; changed src/a.ts');
  expect(text).toContain('  refused  run_command rm -rf src  by policy: rule run_command(rm *) from .jamcli/config.json permissions.deny[0]');
});

test('a project with no sessions has an empty ledger', () => {
  expect(projectLedger(root)).toEqual([]);
  expect(renderLedger([])).toBe('No decisions recorded.');
});
