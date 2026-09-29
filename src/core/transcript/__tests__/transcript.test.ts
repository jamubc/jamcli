import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CoreAgent } from '../../agent.js';
import { createSession } from '../../state.js';
import type { AgentEvent, ChatMessage } from '../../types.js';
import type { ToolDispatcher } from '../../tools/dispatch.js';
import { toProviderMessage } from '../../providers/openai-compat.js';
import { createScriptedProvider } from '../../../testing/scriptedProvider.js';
import { SessionLog, TranscriptRecorder, parseTranscriptLine, projectMessages, sessionFileFor, transcriptToMarkdown } from '../index.js';
import { JAMCLI_VERSION } from '../../version.js';

let root: string;
let previousState: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-transcript-'));
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, 'state');
});

afterEach(() => {
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
});

const dispatcher = (ask: string[] = []): ToolDispatcher => ({
  listTools: () => [],
  requiresApproval: (name) => ask.includes(name),
  isReadOnly: (name) => name.startsWith('read'),
  execute: async (call) => ({ tool: call.name, success: true, output: `${call.name} ran`, durationMs: 0 }),
});
const defs = (...names: string[]) => names.map((name) => ({ type: 'function' as const, function: { name } }));

const writeLegacy = (id: string, lines: string[]) => {
  const file = sessionFileFor(root, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
};

const legacyTurn = (user: string, assistant: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: `turn-${user}`,
    timestamp: '2026-01-02T03:04:05.000Z',
    model: 'old-model',
    messages: [
      { role: 'user', content: user },
      { role: 'assistant', content: assistant },
    ],
    ...extra,
  });

test('a version 1 file resumes, and new turns are appended without rewriting it', () => {
  const original = [
    legacyTurn('first', 'one', { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    legacyTurn('second', 'two'),
  ];
  const file = writeLegacy('old', original);
  const before = fs.readFileSync(file, 'utf8');

  const log = SessionLog.open(root, 'old');
  const session = log.toSession();
  expect(session.messages.map((m) => [m.role, m.content])).toEqual([
    ['user', 'first'],
    ['assistant', 'one'],
    ['user', 'second'],
    ['assistant', 'two'],
  ]);
  expect(session.usage.total_tokens).toBe(15);
  expect(session.modelUsage['old-model'].total_tokens).toBe(15);

  log.append({ type: 'message', message: { role: 'user', content: 'third', timestamp: 1 } });
  const after = fs.readFileSync(file, 'utf8');
  expect(after.startsWith(before)).toBe(true);
  expect(JSON.parse(after.slice(before.length))).toMatchObject({ v: 2, type: 'message' });
  expect(log.messages().map((m) => m.content)).toEqual(['first', 'one', 'second', 'two', 'third']);
});

test('a mixed file reads in order and skips damaged lines', () => {
  const v2 = (message: ChatMessage) => JSON.stringify({ v: 2, type: 'message', ts: 1, message });
  writeLegacy('mixed', [
    legacyTurn('a', 'b'),
    '{"not json',
    v2({ role: 'user', content: 'c', timestamp: 1 }),
    JSON.stringify({ something: 'else' }),
    v2({ role: 'assistant', content: 'd', timestamp: 2 }),
    '{"v":2,"type":"message","ts":3,"mess',
  ]);
  expect(SessionLog.open(root, 'mixed').messages().map((m) => m.content)).toEqual(['a', 'b', 'c', 'd']);
});

test('a session with tool calls resumes with the calls and results in the next request', async () => {
  const log = SessionLog.create(root, { surface: 'cli' });
  const recorder = new TranscriptRecorder(log, { surface: 'cli', model: 'm' });
  const first = createScriptedProvider([
    { text: 'Reading.', toolCalls: [{ id: 'call_a', name: 'read_a', arguments: { path: 'a.txt' } }], usage: { prompt: 3, completion: 2 } },
    { text: 'It says hi.', usage: { prompt: 4, completion: 1 } },
  ]);
  const agent = new CoreAgent({ provider: first, model: 'm', dispatcher: dispatcher(), toolDefinitions: defs('read_a') });
  await agent.run(createSession(root, log.id), 'what is in a.txt?', recorder.handle);

  // A later process resumes from the file alone.
  const resumed = SessionLog.open(root, log.id).toSession();
  const second = createScriptedProvider([{ text: 'Yes.' }]);
  await new CoreAgent({ provider: second, model: 'm', dispatcher: dispatcher(), toolDefinitions: defs('read_a') }).run(
    resumed,
    'are you sure?',
    () => {}
  );
  const request = second.calls[0].messages;
  const call = request.find((m) => m.role === 'assistant' && m.tool_calls?.length);
  expect(call?.content).toBe('Reading.');
  expect(call?.tool_calls?.[0]).toMatchObject({ id: 'call_a', function: { name: 'read_a' } });
  expect(JSON.parse(call?.tool_calls?.[0].function.arguments)).toEqual({ path: 'a.txt' });
  const result = request.find((m) => m.role === 'tool');
  expect(result).toMatchObject({ tool_call_id: 'call_a', content: 'read_a ran', toolName: 'read_a', toolStatus: 'ok' });
  expect(request.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user']);
  expect(resumed.usage.total_tokens).toBe(10);
  expect(resumed.modelUsage.m.total_tokens).toBe(10);
});

test('tool name and status stay out of provider requests', () => {
  const message: ChatMessage = { role: 'tool', content: 'out', tool_call_id: 'c1', toolName: 'grep', toolStatus: 'error', timestamp: 1 };
  expect(toProviderMessage(message)).toEqual({ role: 'tool', content: 'out', tool_call_id: 'c1' });
});

test('decisions, notices, usage, and turn ends are recorded with who decided', async () => {
  const log = SessionLog.create(root, { surface: 'cli' });
  const recorder = new TranscriptRecorder(log, { surface: 'cli', model: 'm' });
  const provider = createScriptedProvider([
    { toolCalls: [{ id: 'w1', name: 'write_a', arguments: {} }], usage: { prompt: 1, completion: 1 } },
    { text: 'Fine.' },
  ]);
  await new CoreAgent({ provider, model: 'm', dispatcher: dispatcher(['write_a']), toolDefinitions: defs('write_a') }).run(
    createSession(root, log.id),
    'write it',
    (event: AgentEvent) => {
      recorder.handle(event);
      if (event.type === 'approval_request') event.decide({ allow: false, feedback: 'not that file' });
    }
  );
  recorder.handle({ type: 'notice', level: 'warn', message: 'heads up', code: 'x' });
  const events = log.events();
  expect(events[0]).toMatchObject({ v: 2, type: 'session', id: log.id, projectRoot: root, surface: 'cli', jamcli: JAMCLI_VERSION });
  expect(events.find((e) => e.type === 'approval')).toMatchObject({
    callId: 'w1',
    tool: 'write_a',
    allow: false,
    scope: 'once',
    by: 'user',
    surface: 'cli',
    feedback: 'not that file',
  });
  const denied = events.find((e) => e.type === 'message' && e.message.role === 'tool');
  expect(denied).toMatchObject({ message: { toolStatus: 'denied', tool_call_id: 'w1' } });
  expect(events.find((e) => e.type === 'usage')).toMatchObject({ model: 'm', usage: { total_tokens: 2 } });
  expect(events.find((e) => e.type === 'end')).toMatchObject({ status: 'ok' });
  expect(events.at(-1)).toMatchObject({ type: 'notice', level: 'warn', message: 'heads up', code: 'x' });
});

test('what each request carried is recorded from the request itself, once until it changes', async () => {
  const log = SessionLog.create(root, { surface: 'cli' });
  const recorder = new TranscriptRecorder(log, { surface: 'cli', model: 'm' });
  const provider = createScriptedProvider([{ text: 'One.' }, { text: 'Two.' }, { text: 'Three.' }]);
  const agent = (systemPrompt: string) => new CoreAgent({ provider, model: 'm', systemPrompt, dispatcher: dispatcher(), toolDefinitions: defs('read_a') });
  let session = (await agent('You are JamCLI.').run(createSession(root, log.id), 'first', recorder.handle)).session!;
  session = (await agent('You are JamCLI.').run(session, 'second', recorder.handle)).session!;
  const contexts = () => log.events().filter((event) => event.type === 'context');
  // Exactly what the provider was sent: the system message and the tool definitions, not a rebuilt copy.
  expect(contexts()).toHaveLength(1);
  expect(contexts()[0]).toMatchObject({ system: provider.calls[0].messages[0].content, tools: provider.calls[0].options.tools });
  expect(provider.calls[0].messages[0]).toMatchObject({ role: 'system', content: 'You are JamCLI.' });

  // A later process on the same log records only a change.
  const resumed = new TranscriptRecorder(SessionLog.open(root, log.id), { surface: 'cli', model: 'm' });
  await agent('You are JamCLI, in plan mode.').run(session, 'third', resumed.handle);
  expect(contexts()).toHaveLength(2);
  expect(contexts()[1]).toMatchObject({ system: 'You are JamCLI, in plan mode.' });
});

test('a model switch is recorded and later usage is attributed to the new model', () => {
  const log = SessionLog.create(root, { surface: 'tui' });
  const recorder = new TranscriptRecorder(log, { surface: 'tui', model: 'a' });
  recorder.handle({ type: 'message', message: { role: 'user', content: 'hi', timestamp: 1 } });
  recorder.switchModel('b');
  recorder.handle({ type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  const events = log.events();
  expect(events.find((e) => e.type === 'model')).toMatchObject({ from: 'a', to: 'b' });
  expect(events.find((e) => e.type === 'usage')).toMatchObject({ model: 'b' });
  expect(log.toSession().modelUsage).toEqual({ b: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
});

test('a session that never gets a message leaves no file and no .jamcli directory', async () => {
  const log = SessionLog.create(root, { surface: 'cli' });
  const recorder = new TranscriptRecorder(log, { surface: 'cli' });
  const result = await new CoreAgent({}).run(createSession(root, log.id), 'hello', recorder.handle);
  expect(result.status).toBe('error');
  expect(fs.existsSync(log.file)).toBe(false);
  expect(fs.existsSync(path.join(root, '.jamcli'))).toBe(false);
});

test('the first write creates a .jamcli directory that git ignores', () => {
  Bun.spawnSync(['git', 'init', '-q', root]);
  const log = SessionLog.create(root, { surface: 'cli' });
  log.append({ type: 'message', message: { role: 'user', content: 'hi', timestamp: 1 } });
  expect(fs.readFileSync(path.join(root, '.jamcli', '.gitignore'), 'utf8')).toContain('\n*\n');
  const status = Bun.spawnSync(['git', 'status', '--porcelain', '--untracked-files=all'], { cwd: root });
  expect(status.stdout.toString()).not.toContain('.jamcli');
});

test('a failed write is reported once and recording stops', () => {
  fs.mkdirSync(path.join(root, '.jamcli'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'history'), 'not a directory');
  const errors: Error[] = [];
  const recorder = new TranscriptRecorder(SessionLog.create(root, { surface: 'cli' }), { surface: 'cli', onError: (e) => errors.push(e) });
  recorder.handle({ type: 'message', message: { role: 'user', content: 'one', timestamp: 1 } });
  recorder.handle({ type: 'message', message: { role: 'user', content: 'two', timestamp: 2 } });
  expect(errors).toHaveLength(1);
});

test('a fork copies events up to a point, names its parent, and leaves the source alone', () => {
  const source = SessionLog.create(root, { surface: 'cli' });
  for (const content of ['q1', 'a1', 'q2', 'a2']) {
    source.append({ type: 'message', message: { role: content.startsWith('q') ? 'user' : 'assistant', content, timestamp: 1 } });
  }
  const before = fs.readFileSync(source.file, 'utf8');
  const fork = SessionLog.fork(root, source.id, { atEvent: 2, surface: 'tui' });
  expect(fork.id).not.toBe(source.id);
  expect(fork.messages().map((m) => m.content)).toEqual(['q1', 'a1']);
  expect(fork.events()[0]).toMatchObject({ type: 'session', surface: 'tui', parent: { session: source.id, event: 2 } });
  expect(fs.readFileSync(source.file, 'utf8')).toBe(before);
  expect(SessionLog.fork(root, source.id, { surface: 'tui' }).messages()).toHaveLength(4);
});

test('a version 1 session forks into a version 2 file', () => {
  writeLegacy('legacy', [legacyTurn('x', 'y')]);
  const fork = SessionLog.fork(root, 'legacy', { surface: 'cli' });
  const lines = fs.readFileSync(fork.file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  expect(lines.every((line) => line.v === 2)).toBe(true);
  expect(fork.messages().map((m) => m.content)).toEqual(['x', 'y']);
});

test('a compaction replaces the messages it summarizes', () => {
  const events = [
    ...['a', 'b', 'c'].flatMap((content) => parseTranscriptLine(JSON.stringify({ v: 2, type: 'message', ts: 1, message: { role: 'user', content, timestamp: 1 } }))),
    ...parseTranscriptLine(JSON.stringify({ v: 2, type: 'compaction', ts: 2, summary: 'a and b', replaced: 2, before: 100, after: 10 })),
  ];
  expect(projectMessages(events).map((m) => m.content)).toEqual(['Summary of the earlier conversation:\na and b', 'c']);
});

test('opening a session that does not exist says where it looked', () => {
  expect(() => SessionLog.open(root, 'nope')).toThrow(/No session named nope in .*history/);
});

test('the recorded version matches package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dir, '../../../../package.json'), 'utf8'));
  expect(JAMCLI_VERSION).toBe(pkg.version);
});

test('a trust-gate request in a log written before the gate was removed still reads, and /copy debug shows it', () => {
  const log = SessionLog.create(root, { surface: 'cli' });
  const recorder = new TranscriptRecorder(log, { surface: 'cli', model: 'm' });
  recorder.handle({ type: 'message', message: { role: 'user', content: 'fix it', timestamp: 1 } });
  log.append({
    type: 'screening',
    model: 'typesafe:jev-latest',
    sent: '{"state":{"task":"fix it"}}',
    answered: '{"answers":{}}',
    results: [
      { tool: 'read_file', verdict: { relevance: 0.9, injection: false }, withheld: false },
      { tool: 'grep', verdict: { relevance: 0.1, injection: false, reason: 'off topic' }, withheld: true },
    ],
  });
  expect(log.events().find((event) => event.type === 'screening')).toMatchObject({ model: 'typesafe:jev-latest', sent: '{"state":{"task":"fix it"}}', answered: '{"answers":{}}' });
  const debug = transcriptToMarkdown(log.events(), { debug: true });
  expect(debug).toContain('### Trust gate (typesafe:jev-latest)');
  // JSON is indented for reading; the log keeps it as sent.
  expect(debug).toContain('"task": "fix it"');
  expect(debug).toContain('2. `grep`: withheld, relevance 0.1, injection no, off topic');
  expect(transcriptToMarkdown(log.events())).not.toContain('Trust gate');
});

test("a tester's note is kept in the log where it was planted, and the export marks it as the person's", () => {
  const log = SessionLog.create(root, { surface: 'tui' });
  const recorder = new TranscriptRecorder(log, { surface: 'tui', model: 'm' });
  // A note before the first message is worth a file on its own.
  recorder.recordNote('the board overlapped here');
  recorder.handle({ type: 'message', message: { role: 'user', content: 'fix it', timestamp: 1 } });
  recorder.recordNote('cost did not update');
  const notes = log.events().filter((event) => event.type === 'note');
  expect(notes).toMatchObject([{ text: 'the board overlapped here' }, { text: 'cost did not update' }]);
  const markdown = transcriptToMarkdown(log.events());
  expect(markdown).toContain('- Tester notes: 2');
  expect(markdown).toContain('> ⚑ **HUMAN TESTER** (not sent to the model): cost did not update');
  expect(markdown.indexOf('the board overlapped here')).toBeLessThan(markdown.indexOf('## User'));
  // The model never sees a note: the conversation the next request carries has none.
  expect(JSON.stringify(projectMessages(log.events()))).not.toContain('overlapped');
});
