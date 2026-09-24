import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type RuntimeOptions } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';

let server: FakeProviderServer;
let root: string;
let logFile: string;
let traceFile: string;

beforeEach(() => {
  server = startFakeProvider();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-observe-')));
  logFile = path.join(root, 'out', 'log.jsonl');
  traceFile = path.join(root, 'out', 'trace.jsonl');
  fs.mkdirSync(path.join(root, '.jamcli'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({
      api_registry: { ollama: { endpoint: server.ollamaBaseUrl } },
      model: 'ollama:fake-model',
      categories: { quick: [{ model: 'ollama:child-model' }] },
      trust: { enabled: false },
    })
  );
  fs.writeFileSync(path.join(root, 'notes.txt'), 'the token is tok-abcdef123456\n');
});
afterEach(() => {
  expect(server.pending()).toBe(0);
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const start = (options: Partial<RuntimeOptions> = {}) =>
  createRuntime({ projectRoot: root, surface: 'headless', mcp: false, env: { MY_API_TOKEN: 'tok-abcdef123456' }, allowTools: ['read_file', 'task'], ...options });
const read = (file: string) => fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const readCall = { toolCalls: [{ id: 'r1', name: 'read_file', arguments: { path: 'notes.txt' } }], usage: { prompt: 40, completion: 5 } };

test('a turn is traced as a session, a turn, its model requests, and its tool calls', async () => {
  const runtime = await start({ observe: { level: 'info', logFile, traceFile } });
  server.enqueue(readCall, { text: 'read it' });
  await runtime.run('read notes.txt');
  await runtime.close();

  const spans = read(traceFile);
  const byName = (name: string) => spans.filter((span) => span.name === name);
  const [session] = byName('session');
  const [turn] = byName('invoke_agent jamcli');
  const chats = byName('chat fake-model');
  const [tool] = byName('execute_tool read_file');
  expect(chats).toHaveLength(2);
  expect(new Set(spans.map((span) => span.trace_id)).size).toBe(1);
  expect(turn.parent_span_id).toBe(session.span_id);
  for (const span of [...chats, tool]) expect(span.parent_span_id).toBe(turn.span_id);
  expect(session.attributes).toMatchObject({ 'gen_ai.conversation.id': runtime.sessionId, 'jamcli.surface': 'headless', 'gen_ai.request.model': 'fake-model' });
  expect(chats[0]).toMatchObject({ kind: 'client', attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': 'ollama', 'gen_ai.request.model': 'fake-model' } });
  expect(chats[0].attributes).toMatchObject({ 'gen_ai.usage.input_tokens': 40, 'gen_ai.usage.output_tokens': 5 });
  expect(tool).toMatchObject({ status: 'ok', attributes: { 'gen_ai.tool.name': 'read_file', 'gen_ai.tool.call.id': 'r1', 'jamcli.tool.status': 'ok' } });
  // The session span ends last, when the session closes.
  expect(spans.at(-1).name).toBe('session');

  // At info level each request and call is logged, but not what was said.
  const log = read(logFile);
  expect(log.map((line) => line.msg)).toEqual(expect.arrayContaining(['session started', 'turn started', 'tool call', 'model usage', 'turn ended', 'session ended']));
  expect(log.some((line) => line.msg === 'prompt' || line.msg === 'tool output')).toBe(false);
  expect(JSON.stringify(log)).not.toContain('read notes.txt');
});

test('at debug level prompts and outputs are logged, with credentials redacted', async () => {
  const runtime = await start({ observe: { level: 'debug', logFile } });
  server.enqueue(readCall, { text: 'read it' });
  await runtime.run('read notes.txt');
  await runtime.close();
  const log = read(logFile);
  expect(log.find((line) => line.msg === 'prompt')?.text).toBe('read notes.txt');
  expect(log.find((line) => line.msg === 'response')?.text).toBe('read it');
  expect(log.find((line) => line.msg === 'tool output')?.output).toContain('[redacted:MY_API_TOKEN]');
  expect(log.some((line) => line.msg === 'model request' && line.model === 'fake-model')).toBe(true);
  expect(fs.readFileSync(logFile, 'utf8')).not.toContain('tok-abcdef123456');
});

test('a compaction and a delegated run are traced, the child under the turn that started it', async () => {
  const runtime = await start({ observe: { level: 'warn', logFile, traceFile } });
  server.enqueue(
    { toolCalls: [{ id: 't1', name: 'task', arguments: { category: 'quick', prompt: 'look around' } }] },
    { text: 'child done' },
    { text: 'parent done' },
    { text: 'another turn' }
  );
  await runtime.run('delegate');
  await runtime.run('again');
  server.enqueue({ text: 'The user delegated and asked again.' });
  expect(await runtime.compact()).toBe(true);
  await runtime.close();

  const spans = read(traceFile);
  const sessions = spans.filter((span) => span.name === 'session');
  const parentSession = sessions.find((span) => span.attributes['jamcli.surface'] === 'headless');
  const [firstTurn] = spans.filter((span) => span.name === 'invoke_agent jamcli' && span.parent_span_id === parentSession.span_id);
  const child = sessions.find((span) => span.attributes['jamcli.surface'] === 'child');
  expect(child.parent_span_id).toBe(firstTurn.span_id);
  expect(child.trace_id).toBe(firstTurn.trace_id);
  const childTurn = spans.find((span) => span.name === 'invoke_agent jamcli' && span.parent_span_id === child.span_id);
  expect(spans.some((span) => span.name === 'chat child-model' && span.parent_span_id === childTurn.span_id)).toBe(true);

  const compaction = spans.find((span) => span.name === 'compaction');
  expect(compaction).toMatchObject({ parent_span_id: parentSession.span_id, attributes: { 'jamcli.compaction.trigger': 'manual', 'jamcli.compaction.strategy': 'summary' } });
  expect(compaction.duration_ms).toBeGreaterThanOrEqual(0);
  // At warn level nothing went wrong, so nothing was logged.
  expect(fs.existsSync(logFile)).toBe(false);
});
