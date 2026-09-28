import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { SessionLog } from '../../transcript/index.js';
import type { AgentEvent } from '../../types.js';

let server: FakeProviderServer;
let root: string;

beforeEach(() => {
  server = startFakeProvider();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-elision-'));
  const dir = path.join(root, '.jamcli');
  fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, models: { 'ollama:fake-model': { context_window: 24_000 } }, permissions: { mode: 'accept-edits' }, trust: { enabled: false }, sandbox: { enabled: false }, lsp: { enabled: false } })
  );
  fs.writeFileSync(path.join(dir, 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
});
afterEach(() => {
  expect(server.pending()).toBe(0);
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const start = () => createRuntime({ projectRoot: root, surface: 'headless', mcp: false });
const read = (id: string, file: string) => ({ toolCalls: [{ id, name: 'read_file', arguments: { path: file } }] });

test('short of the trigger, a read superseded by an edit is stubbed once, the model reads the stub, and the log rebuilds the same conversation', async () => {
  const runtime = await start();
  const { used, trigger } = runtime.contextUsage();
  // Two reads that together carry the conversation past 60 percent of the trigger, but not past it.
  const lines = Math.floor((0.3 * (trigger - used) - 40) / 21);
  for (const name of ['a', 'b']) fs.writeFileSync(path.join(root, `${name}.txt`), Array.from({ length: lines }, () => name.repeat(76)).join('\n'));
  server.enqueue(
    read('r1', 'a.txt'),
    { toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'aaaa', replace_string: 'AAAA' } }] },
    read('r2', 'b.txt'),
    { text: 'Read both, changed a.' }
  );
  const events: AgentEvent[] = [];
  const result = await runtime.run('read a, change it, read b', (event) => events.push(event));
  expect(result.response).toBe('Read both, changed a.');
  expect(events.filter((event) => event.type === 'compaction')).toEqual([]);
  const elisions = events.filter((event) => event.type === 'elision') as Extract<AgentEvent, { type: 'elision' }>[];
  expect(elisions).toHaveLength(1);
  expect(elisions[0]).toMatchObject({ stage: 'E1', message: 2, stub: '[read a.txt; superseded by edit at step 2]' });
  expect(elisions[0].tokensRemoved).toBeGreaterThan(100);
  // The last request carried the stub in place of the read, and the rest whole.
  const last = server.completions().at(-1)!.body.messages;
  expect(last.find((message: any) => message.tool_call_id === 'r1').content).toBe(elisions[0].stub);
  expect(last.find((message: any) => message.tool_call_id === 'r2').content).toContain('bbbb');
  // The log holds the original result and the elision, and projects the same conversation the runtime has.
  const log = SessionLog.open(root, runtime.sessionId);
  const recorded = log.events();
  expect(recorded.filter((event) => event.type === 'elision')).toHaveLength(1);
  const original = recorded.find((event) => event.type === 'message' && event.message.tool_call_id === 'r1') as Extract<(typeof recorded)[number], { type: 'message' }>;
  expect(original.message.content).toContain('aaaa');
  expect(log.toSession().messages.map((message) => [message.role, message.content])).toEqual(runtime.session.messages.map((message) => [message.role, message.content]));
  // A second crossing in the same session does not elide again until a compaction has run.
  server.enqueue(read('r3', 'b.txt'), { text: 'again' });
  const more: AgentEvent[] = [];
  await runtime.run('read b again', (event) => more.push(event));
  expect(more.filter((event) => event.type === 'elision')).toEqual([]);
  await runtime.close();
});
