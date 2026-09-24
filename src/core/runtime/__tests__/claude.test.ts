import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';

let server: FakeProviderServer;
let root: string;
const sharedCache = process.env.JAMCLI_CACHE_DIR;

beforeEach(() => {
  server = startFakeProvider();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-claude-'));
  process.env.JAMCLI_CACHE_DIR = path.join(root, '.cache');
});
afterEach(() => {
  expect(server.pending()).toBe(0);
  server.close();
  process.env.JAMCLI_CACHE_DIR = sharedCache;
  fs.rmSync(root, { recursive: true, force: true });
});

/** A Claude model from the bundled table, and the default profile's temperature. */
function configure(model: string, config: Record<string, unknown> = {}) {
  const dir = path.join(root, '.jamcli');
  fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ api_registry: { anthropic: { base_url: server.anthropicBaseUrl, api_key: 'sk-ant-test-0123456789' } }, trust: { enabled: false }, ...config })
  );
  fs.writeFileSync(
    path.join(dir, 'profiles', 'default.json'),
    JSON.stringify({ name: 'Default', preferred_provider: 'anthropic', preferred_model: model, temperature: 0.7 })
  );
}

const start = (options: Partial<Parameters<typeof createRuntime>[0]> = {}) => createRuntime({ projectRoot: root, surface: 'headless', mcp: false, ...options });
const lastBody = () => server.completions().at(-1)!.body;

test("the default profile's temperature does not reach a Claude model that refuses it", async () => {
  configure('claude-opus-5-5');
  const runtime = await start();
  server.enqueue({ text: 'ok' });
  expect((await runtime.run('hi')).status).toBe('ok');
  expect(lastBody().model).toBe('claude-opus-5-5');
  expect(lastBody().temperature).toBeUndefined();

  configure('claude-haiku-4-5');
  const older = await start();
  server.enqueue({ text: 'ok' });
  await older.run('hi');
  expect(lastBody().temperature).toBe(0.7);
});

test('a current Claude model thinks adaptively and shows it, and its signed thinking comes back whole', async () => {
  configure('claude-opus-5-5');
  const runtime = await start();
  server.enqueue({ text: 'done', reasoning: 'weighing it', reasoningSignature: 'sig-1' });
  const reasoning: string[] = [];
  await runtime.run('think about it', (event) => {
    if (event.type === 'reasoning') reasoning.push(event.delta);
  });
  expect(lastBody().thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  expect(reasoning.join('')).toBe('weighing it');
  const reply = runtime.session.messages.at(-1)!;
  expect(reply.reasoningBlocks).toEqual([{ type: 'thinking', text: 'weighing it', signature: 'sig-1' }]);
});

/** The signatures of the thinking blocks a request replays. */
const replayed = () =>
  lastBody()
    .messages.flatMap((message: any) => (Array.isArray(message.content) ? message.content : []))
    .filter((block: any) => block.type === 'thinking')
    .map((block: any) => block.signature);

test('signed thinking is replayed while its prefix holds, and left out once the prefix changes', async () => {
  configure('claude-opus-5-5');
  const runtime = await start();
  server.enqueue({ text: 'one', reasoning: 'r1', reasoningSignature: 'sig-1' }, { text: 'two', reasoning: 'r2', reasoningSignature: 'sig-2' });
  await runtime.run('first');
  await runtime.run('second');
  expect(replayed()).toEqual(['sig-1']);

  // A mode switch changes the system prompt and the tools: what came before is left out, what follows is kept.
  runtime.setPermissionMode('plan');
  server.enqueue({ text: 'three', reasoning: 'r3', reasoningSignature: 'sig-3' }, { text: 'four' });
  await runtime.run('third');
  expect(replayed()).toEqual([]);
  await runtime.run('fourth');
  expect(replayed()).toEqual(['sig-3']);

  // A continued session cannot know its prefix is unchanged, so it starts afresh.
  const continued = await start({ sessionId: runtime.sessionId });
  server.enqueue({ text: 'five' });
  await continued.run('fifth');
  expect(replayed()).toEqual([]);
});

test('after a compaction, the kept turns\' thinking is left out and new thinking is kept', async () => {
  configure('claude-opus-5-5');
  const runtime = await start();
  server.enqueue({ text: 'one', reasoning: 'r1', reasoningSignature: 'sig-1' }, { text: 'two', reasoning: 'r2', reasoningSignature: 'sig-2' });
  await runtime.run('first');
  await runtime.run('second');
  server.enqueue({ text: 'Asked twice.' });
  expect(await runtime.compact()).toBe(true);
  // A switch builds a new agent, which must start from the compaction too.
  runtime.setModel('anthropic:claude-opus-5-5');
  server.enqueue({ text: 'three', reasoning: 'r3', reasoningSignature: 'sig-3' }, { text: 'four' });
  await runtime.run('third');
  // The second turn was kept verbatim, but its thinking was signed against the turns the summary replaced.
  expect(lastBody().messages.some((message: any) => JSON.stringify(message.content).includes('two'))).toBe(true);
  expect(replayed()).toEqual([]);
  await runtime.run('fourth');
  expect(replayed()).toEqual(['sig-3']);
});

test('a compaction in the middle of a turn leaves the kept steps\' thinking out of the next step', async () => {
  configure('claude-x', { models: { 'anthropic:claude-x': { context_window: 20_000, max_output: 4_000, thinking: 'adaptive' } } });
  const runtime = await start({ allowTools: ['read_file'] });
  // Files sized so that three reads fit under the threshold and four do not.
  const { used, trigger } = runtime.contextUsage();
  const lines = Math.floor((Math.floor((trigger - used) / 3.5) - 40) / 21);
  for (const name of ['a', 'b', 'c', 'd']) fs.writeFileSync(path.join(root, `${name}.txt`), Array.from({ length: lines }, () => name.repeat(76)).join('\n'));
  const read = (id: string, file: string, signature: string) => ({
    toolCalls: [{ id, name: 'read_file', arguments: { path: file } }],
    reasoning: `reading ${file}`,
    reasoningSignature: signature,
  });
  server.enqueue(
    read('c1', 'a.txt', 'sig-1'),
    read('c2', 'b.txt', 'sig-2'),
    read('c3', 'c.txt', 'sig-3'),
    read('c4', 'd.txt', 'sig-4'),
    { text: 'Read a, b, and c.' },
    { text: 'All read.' }
  );
  const result = await runtime.run('read the four files');
  expect(result.response).toBe('All read.');
  // Before the compaction, each step replayed the turn's thinking so far.
  const steps = server.completions().filter((request) => request.body.stream);
  const signatures = (body: any) =>
    body.messages.flatMap((message: any) => (Array.isArray(message.content) ? message.content : [])).filter((block: any) => block.type === 'thinking').map((block: any) => block.signature);
  expect(signatures(steps[3].body)).toEqual(['sig-1', 'sig-2', 'sig-3']);
  // After it, the kept step's thinking was signed against what the summary replaced.
  const last = steps.at(-1)!.body;
  expect(last.messages[0].content[0].text).toStartWith('Summary of the earlier conversation:');
  expect(signatures(last)).toEqual([]);
});
