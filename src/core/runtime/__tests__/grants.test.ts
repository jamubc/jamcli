import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { suggestPatterns } from '../../approval.js';
import { PermissionEngine } from '../../permissions/engine.js';
import { createBuiltinRegistry } from '../../tools/registry.js';
import { toolNaming } from '../tools.js';
import type { AgentEvent, ToolCall } from '../../types.js';

let server: FakeProviderServer;
let root: string;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-grants-'));
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } } }));
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const command = (text: string, id = 'c1'): ToolCall => ({ id, name: 'run_command', arguments: { command: text } });

test('suggestions are rules the engine matches, one per part of a compound command', () => {
  expect(suggestPatterns(command('npm test --watch'))).toEqual(['run_command(npm test --watch)', 'run_command(npm test *)', 'run_command(npm *)']);
  expect(suggestPatterns(command('npm test && npm run lint'))).toEqual([
    'run_command(npm test), run_command(npm run lint)',
    'run_command(npm test *), run_command(npm run *)',
    'run_command(npm *)',
  ]);
  expect(suggestPatterns(command('ls'))).toEqual(['run_command(ls)', 'run_command(ls *)']);
  expect(suggestPatterns(command('echo $(id)'))).toEqual([]);
  const patch = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n';
  expect(suggestPatterns({ id: 'p', name: 'apply_patch', arguments: { patch } })).toEqual(['apply_patch(src/a.ts)', 'apply_patch(src/**)', 'apply_patch']);
  expect(suggestPatterns({ id: 'e', name: 'edit', arguments: { path: 'src/a.ts' } })).toEqual(['edit(src/a.ts)', 'edit(src/**)', 'edit']);
  expect(suggestPatterns({ id: 'm', name: 'github__create_issue', arguments: {} })).toEqual(['github__create_issue', 'github__*']);
});

test('every suggestion, once granted, allows the call it was made for', () => {
  const calls = [command('npm test --watch'), command('npm test && npm run lint'), command('cd web && make build')];
  for (const call of calls) {
    for (const suggestion of suggestPatterns(call)) {
      const engine = new PermissionEngine({ projectRoot: root, ...toolNaming(createBuiltinRegistry()) });
      expect(engine.decide(call).decision).toBe('ask');
      expect(engine.grant(suggestion)).toBeUndefined();
      expect(engine.decide(call).decision).toBe('allow');
    }
  }
});

test('a project grant is written to config.local.json and holds in the next session', async () => {
  fs.writeFileSync(path.join(root, '.jamcli', 'config.local.json'), JSON.stringify({ theme: 'dark', permissions: { allow: ['grep'] } }));
  const first = await createRuntime({ projectRoot: root, surface: 'tui', mcp: false });
  server.enqueue({ toolCalls: [command('echo granted')] }, { toolCalls: [command('echo more', 'c3')] }, { text: 'ok' });
  const prompted: string[] = [];
  await first.run('run it', (event: AgentEvent) => {
    if (event.type !== 'approval_request') return;
    prompted.push(event.call.id);
    event.decide({ allow: true, scope: 'project', pattern: event.request!.suggestions.at(-1) });
  });
  expect(prompted).toEqual(['c1']);
  const saved = JSON.parse(fs.readFileSync(path.join(root, '.jamcli', 'config.local.json'), 'utf8'));
  expect(saved).toEqual({ theme: 'dark', permissions: { allow: ['grep', 'run_command(echo *)'] } });

  const second = await createRuntime({ projectRoot: root, surface: 'tui', mcp: false });
  server.enqueue({ toolCalls: [command('echo again', 'c2')] }, { text: 'ok' });
  const asked: string[] = [];
  await second.run('run it again', (event) => {
    if (event.type === 'approval_request') asked.push(event.call.id);
  });
  expect(asked).toEqual([]);
});

test('a grant that cannot be saved still holds for the session, and says so', async () => {
  fs.writeFileSync(path.join(root, '.jamcli', 'config.local.json'), '{ not json');
  const runtime = await createRuntime({ projectRoot: root, surface: 'tui', mcp: false });
  server.enqueue({ toolCalls: [command('echo one')] }, { toolCalls: [command('echo two', 'c2')] }, { text: 'ok' });
  const events: AgentEvent[] = [];
  await runtime.run('run twice', (event) => {
    events.push(event);
    if (event.type === 'approval_request') event.decide({ allow: true, scope: 'project', pattern: 'run_command(echo *)' });
  });
  expect(events.filter((event) => event.type === 'approval_request')).toHaveLength(1);
  expect(events.some((event) => event.type === 'notice' && event.message.includes('config.local.json is not valid JSON'))).toBe(true);
});
