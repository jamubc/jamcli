import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { SessionLog } from '../../transcript/index.js';
import { estimateMessage } from '../../context/index.js';
import type { AgentEvent, ChatMessage } from '../../types.js';

let server: FakeProviderServer;
let root: string;
const sharedCache = process.env.JAMCLI_CACHE_DIR;

// Each test gets its own server, so a turn one test leaves unused cannot answer another's request.
beforeEach(() => {
  server = startFakeProvider();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-context-'));
  process.env.JAMCLI_CACHE_DIR = path.join(root, '.cache');
});
afterEach(() => {
  expect(server.pending()).toBe(0);
  server.close();
  process.env.JAMCLI_CACHE_DIR = sharedCache;
  fs.rmSync(root, { recursive: true, force: true });
});

function configure(config: Record<string, unknown> = {}, profile: Record<string, unknown> = {}) {
  const dir = path.join(root, '.jamcli');
  fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      api_registry: {
        ollama: { endpoint: server.ollamaBaseUrl },
        openai: { base_url: server.openaiBaseUrl, api_key: 'sk-test-0123456789abcdef' },
      },
      models: { 'ollama:fake-model': { context_window: 20_000 } },
      trust: { enabled: false },
      ...config,
    })
  );
  fs.writeFileSync(path.join(dir, 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model', ...profile }));
}

const start = (options: Partial<Parameters<typeof createRuntime>[0]> = {}) =>
  createRuntime({ projectRoot: root, surface: 'headless', mcp: false, allowTools: ['read_file'], ...options });

const read = (id: string, file: string) => ({ toolCalls: [{ id, name: 'read_file', arguments: { path: file } }] });

/**
 * Files sized so that three reads fit under the trigger and four do not. A line read back
 * is about 84 characters with its number, so about 21 tokens.
 */
function plantFiles(runtime: Awaited<ReturnType<typeof start>>) {
  const { used, trigger } = runtime.contextUsage();
  const perStep = Math.floor((trigger - used) / 3.5);
  const lines = Math.floor((perStep - 40) / 21);
  for (const name of ['a', 'b', 'c', 'd']) {
    fs.writeFileSync(path.join(root, `${name}.txt`), Array.from({ length: lines }, () => name.repeat(76)).join('\n'));
  }
}

const collect = () => {
  const events: AgentEvent[] = [];
  return { events, onEvent: (event: AgentEvent) => events.push(event) };
};

const orphans = (messages: ChatMessage[]) => {
  const calls = new Set(messages.flatMap((message: any) => (message.tool_calls ?? []).map((call: any) => call.id)));
  return messages.filter((message: any) => message.role === 'tool' && !calls.has(message.tool_call_id));
};

test('a turn that outgrows the window is summarized between steps, and the next request carries the summary', async () => {
  configure();
  const runtime = await start();
  plantFiles(runtime);
  const small = { usage: { prompt: 10, completion: 1 } };
  server.enqueue(
    { ...read('c1', 'a.txt'), ...small },
    { ...read('c2', 'b.txt'), ...small },
    { ...read('c3', 'c.txt'), ...small },
    { ...read('c4', 'd.txt'), ...small },
    { text: 'Read a, b, and c so far.', usage: { prompt: 5_000, completion: 50 } },
    { text: 'All four read.', ...small }
  );
  const { events, onEvent } = collect();
  const result = await runtime.run('read the four files', onEvent);
  expect(result.response).toBe('All four read.');

  const compactions = events.filter((event) => event.type === 'compaction');
  expect(compactions).toHaveLength(1);
  const compaction = compactions[0] as Extract<AgentEvent, { type: 'compaction' }>;
  expect(compaction).toMatchObject({ strategy: 'summary', trigger: 'auto', replaced: 7 });
  const { trigger } = runtime.contextUsage();
  expect(compaction.beforeTokens).toBeGreaterThan(trigger);
  expect(compaction.afterTokens).toBeLessThan(trigger);
  expect(events.some((event) => event.type === 'notice' && event.message.startsWith('The earlier conversation was summarized to fit the context window:'))).toBe(true);

  // The summarizer saw the older steps, and the last request starts from its summary.
  const [summaryRequest, last] = server.completions().slice(-2);
  expect(summaryRequest.body.messages[0].content).toContain('TOOL CALL read_file: {"path":"a.txt"}');
  const sent = last.body.messages.filter((message: any) => message.role !== 'system');
  expect(sent[0].content).toStartWith('Summary of the earlier conversation:\nRead a, b, and c so far.');
  expect(sent[0].content).toContain('The request being worked on, verbatim:\nread the four files');
  expect(sent.map((message: any) => message.role)).toEqual(['user', 'assistant', 'tool']);
  expect(orphans(sent)).toEqual([]);

  // The log rebuilds the same conversation, and the summary request is counted.
  const rebuilt = SessionLog.open(root, runtime.sessionId).toSession().messages;
  expect(rebuilt.map((message) => [message.role, message.content])).toEqual(runtime.session.messages.map((message) => [message.role, message.content]));
  expect(runtime.spend()).toMatchObject({ requests: 6, models: [{ model: 'ollama:fake-model', usage: { prompt_tokens: 5_050 } }] });
  expect(result.usage.prompt_tokens).toBe(5_050);
});

test('a summary that fails leaves the older steps out, says so, and the turn goes on', async () => {
  configure();
  const runtime = await start();
  plantFiles(runtime);
  server.enqueue(read('c1', 'a.txt'), read('c2', 'b.txt'), read('c3', 'c.txt'), read('c4', 'd.txt'), { status: 400, errorBody: { error: 'summarizer broke' } }, { text: 'done' });
  const { events, onEvent } = collect();
  const result = await runtime.run('read the four files', onEvent);
  expect(result.response).toBe('done');
  expect(events.find((event) => event.type === 'compaction')).toMatchObject({ strategy: 'drop', replaced: 7 });
  const notice = events.find((event) => event.type === 'notice' && event.level === 'warn') as Extract<AgentEvent, { type: 'notice' }>;
  expect(notice.message).toContain('could not be summarized (ollama returned 400: summarizer broke');
  expect(notice.message).toContain('so 7 messages were left out to fit the context window');
  const sent = server.completions().at(-1)!.body.messages.filter((message: any) => message.role !== 'system');
  expect(sent[0].content).toContain('could not be summarized, so it was left out');
  expect(orphans(sent)).toEqual([]);
});

test('/compact summarizes on request, with the focus given, and the next turn builds on it', async () => {
  configure();
  const runtime = await start();
  server.enqueue({ text: 'The parser lives in src/parse.ts.' });
  await runtime.run('where is the parser?');
  // One turn is nothing to compact.
  expect(await runtime.compact()).toBe(false);

  server.enqueue({ text: 'Tests are in test/.' });
  await runtime.run('and the tests?');
  server.enqueue({ text: 'Asked where the parser is: src/parse.ts.' });
  const { events, onEvent } = collect();
  expect(await runtime.compact('the parser', onEvent)).toBe(true);
  expect(server.completions().at(-1)!.body.messages[0].content).toContain('Give particular attention to: the parser');
  expect(events.find((event) => event.type === 'compaction')).toMatchObject({ trigger: 'manual', strategy: 'summary', replaced: 2 });
  expect(events.some((event) => event.type === 'notice' && event.message.startsWith('The earlier conversation was summarized: '))).toBe(true);
  // The latest turn is kept whole.
  expect(runtime.session.messages.map((message) => message.role)).toEqual(['user', 'user', 'assistant']);

  server.enqueue({ text: 'The lexer is in src/lex.ts.' });
  await runtime.run('and the lexer?');
  const sent = server.completions().at(-1)!.body.messages.filter((message: any) => message.role !== 'system');
  expect(sent[0].content).toStartWith('Summary of the earlier conversation:\nAsked where the parser is');
  expect(sent.at(-1).content).toBe('and the lexer?');

  // A continued session starts from the summary too, and the log marks the request.
  const continued = await start({ sessionId: runtime.sessionId });
  expect(continued.session.messages[0].content).toStartWith('Summary of the earlier conversation:');
  expect(SessionLog.open(root, runtime.sessionId).events().find((event) => event.type === 'compaction')).toMatchObject({ trigger: 'manual', strategy: 'summary' });
});

test('/compact waits for no one: it is refused while a turn runs', async () => {
  configure();
  const runtime = await start();
  server.enqueue({ text: 'slow', delayMs: 300 });
  const turn = runtime.run('take your time');
  await Bun.sleep(50);
  await expect(runtime.compact()).rejects.toThrow('A turn is running in this session');
  await turn;
});

test('a model whose window is a guess is compacted only when its provider refuses the request as too long', async () => {
  configure({}, { preferred_provider: 'openai', preferred_model: 'mystery' });
  const runtime = await start();
  expect(runtime.contextUsage().windowKnown).toBe(false);
  // Well past the guessed trigger, and nothing is compacted ahead of time.
  server.enqueue({ text: 'noted' });
  const { events, onEvent } = collect();
  await runtime.run(`remember this: ${'x'.repeat(40_000)}`, onEvent);
  expect(events.filter((event) => event.type === 'compaction')).toEqual([]);

  server.enqueue(
    { status: 400, errorBody: { error: { message: "This model's maximum context length is 12000 tokens." } } },
    { text: 'Asked to remember a long string.' },
    { text: 'done' }
  );
  const result = await runtime.run('and now?', onEvent);
  expect(result.response).toBe('done');
  expect(events.find((event) => event.type === 'compaction')).toMatchObject({ trigger: 'auto', strategy: 'summary', replaced: 2 });
  const retried = server.completions().at(-1)!.body.messages.filter((message: any) => message.role !== 'system');
  expect(retried[0].content).toStartWith('Summary of the earlier conversation:\nAsked to remember a long string.');

  // A second refusal is reported rather than compacted again, though there is more to compact.
  // A large turn in the middle, so the first compaction keeps the turns after it and leaves more to compact.
  server.enqueue({ text: 'two' }, { text: 'three' });
  await runtime.run(`turn two: ${'y'.repeat(8_000)}`);
  await runtime.run('turn three');
  server.enqueue(
    { status: 400, errorBody: { error: { message: 'prompt is too long' } } },
    { text: 'Still remembering.' },
    { status: 400, errorBody: { error: { message: 'prompt is too long' } } }
  );
  const before = events.filter((event) => event.type === 'compaction').length;
  const refused = await runtime.run('once more', onEvent);
  expect(refused.status).toBe('error');
  expect(refused.error).toContain('prompt is too long');
  expect(events.filter((event) => event.type === 'compaction').length - before).toBe(1);
});

test('a context compaction cannot bring under the threshold is reported once, and not retried every step', async () => {
  // The system prompt and tool definitions alone are over this window's threshold.
  configure({ models: { 'ollama:fake-model': { context_window: 4_000 } } });
  const runtime = await start();
  expect(runtime.contextUsage().used).toBeGreaterThan(runtime.contextUsage().trigger);
  fs.writeFileSync(path.join(root, 'a.txt'), 'small');
  server.enqueue(read('c1', 'a.txt'), { text: 'done' });
  const { events, onEvent } = collect();
  await runtime.run('read a.txt', onEvent);
  const stuck = events.filter((event) => event.type === 'notice' && event.message.startsWith('The conversation is still above the compaction threshold'));
  expect(stuck).toHaveLength(1);
  expect(events.filter((event) => event.type === 'compaction')).toEqual([]);
  expect(server.completions()).toHaveLength(2);
});

test('with auto_compact off, nothing is compacted on its own, and a refusal is reported', async () => {
  configure({ context: { auto_compact: false } });
  const runtime = await start();
  plantFiles(runtime);
  server.enqueue(read('c1', 'a.txt'), read('c2', 'b.txt'), read('c3', 'c.txt'), read('c4', 'd.txt'), { text: 'done' });
  const { events, onEvent } = collect();
  await runtime.run('read the four files', onEvent);
  expect(events.filter((event) => event.type === 'compaction')).toEqual([]);
  expect(runtime.contextUsage()).toMatchObject({ autoCompact: false });
  expect(runtime.contextUsage().used).toBeGreaterThan(runtime.contextUsage().trigger);
});

test('the estimate learns from what the provider counts, except from Ollama', async () => {
  configure({ models: { 'openai:counted': { context_window: 100_000 } } }, { preferred_provider: 'openai', preferred_model: 'counted' });
  const runtime = await start();
  const prompt = 'how many tokens is this?';
  const estimate = runtime.contextUsage().used + estimateMessage({ role: 'user', content: prompt, timestamp: 0 });
  server.enqueue({ text: 'ok', usage: { prompt: estimate * 2, completion: 1 } });
  await runtime.run(prompt);
  expect(runtime.contextUsage().correction).toBe(2);

  configure();
  const local = await start();
  const localEstimate = local.contextUsage().used + estimateMessage({ role: 'user', content: prompt, timestamp: 0 });
  server.enqueue({ text: 'ok', usage: { prompt: localEstimate * 2, completion: 1 } });
  await local.run(prompt);
  expect(local.contextUsage().correction).toBe(1);
});
