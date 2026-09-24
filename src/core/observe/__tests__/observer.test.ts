import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createObserver, type SpanData } from '../observer.js';
import { instrumentProvider } from '../instrument.js';
import { LOG_RETENTION_DAYS, pruneLogs } from '../setup.js';
import { createHookBus } from '../../hooks/index.js';
import { createScriptedProvider } from '../../../testing/scriptedProvider.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-observe-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const lines = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const collect = () => {
  const spans: SpanData[] = [];
  return { spans, sink: { write: (span: SpanData) => void spans.push(span) } };
};

test('each level includes the ones before it, and nothing is written until a line is', () => {
  const file = path.join(dir, 'logs', 'run.jsonl');
  const echoed: string[] = [];
  const observer = createObserver({ level: 'info', logFile: file, echo: (line) => echoed.push(line), redact: (text) => text.replace('sk-secret-123', '[redacted]') });
  observer.log('debug', 'hidden');
  expect(fs.existsSync(file)).toBe(false);
  observer.log('info', 'shown', { detail: { key: 'sk-secret-123' }, absent: undefined });
  observer.log('error', 'failed with sk-secret-123');
  expect(lines(file).map((line) => [line.level, line.msg])).toEqual([
    ['info', 'shown'],
    ['error', 'failed with [redacted]'],
  ]);
  expect(lines(file)[0].detail).toEqual({ key: '[redacted]' });
  expect(echoed).toEqual(['[info] shown detail={"key":"[redacted]"}', '[error] failed with [redacted]']);
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);

  const off = createObserver({ level: 'off', logFile: path.join(dir, 'off.jsonl') });
  off.log('error', 'nothing');
  expect(fs.existsSync(path.join(dir, 'off.jsonl'))).toBe(false);
});

test('a span carries its trace and parent, its attributes, and its time', () => {
  const { spans, sink } = collect();
  let clock = 1_000;
  const observer = createObserver({ spans: [sink], now: () => clock, redact: (text) => text.replace('sk-secret-123', '[redacted]') });
  const root = observer.startSpan('session', { attributes: { a: 1, skipped: undefined } });
  const child = observer.startSpan('turn', { parent: root });
  clock = 1_250;
  child.end({ error: 'it broke', attributes: { b: 'x', key: 'sk-secret-123' } });
  child.end();
  root.end({ error: 'failed with sk-secret-123' });
  expect(spans).toHaveLength(2);
  expect(spans[0]).toMatchObject({ name: 'turn', traceId: root.traceId, parentSpanId: root.spanId, startMs: 1_000, endMs: 1_250, status: 'error', error: 'it broke', attributes: { b: 'x', key: '[redacted]' } });
  expect(spans[1]).toMatchObject({ name: 'session', status: 'error', error: 'failed with [redacted]', attributes: { a: 1 } });
  expect(spans[1].parentSpanId).toBeUndefined();
  expect(root.traceId).toMatch(/^[0-9a-f]{32}$/);
  expect(root.spanId).toMatch(/^[0-9a-f]{16}$/);
});

test('a model request becomes a chat span with the GenAI attributes, however its reading ends', async () => {
  const { spans, sink } = collect();
  const observer = createObserver({ spans: [sink] });
  const turn = observer.startSpan('turn');
  const provider = instrumentProvider(createScriptedProvider([{ text: 'hello there', usage: { prompt: 12, completion: 3 } }, { text: 'again' }]), {
    observer,
    providerName: 'ollama',
    parent: () => turn,
  });
  for await (const _chunk of provider.streamChat([{ role: 'user', content: 'hi', timestamp: 0 }], { model: 'qwen', maxOutputTokens: 100 })) {
    // read to the end
  }
  expect(spans[0]).toMatchObject({
    name: 'chat qwen',
    kind: 'client',
    parentSpanId: turn.spanId,
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'ollama',
      'gen_ai.request.model': 'qwen',
      'gen_ai.request.max_tokens': 100,
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 3,
    },
  });
  // A reader that stops early still ends the span.
  for await (const _chunk of provider.streamChat([], { model: 'qwen' })) break;
  expect(spans).toHaveLength(2);

  const failing = instrumentProvider(createScriptedProvider([]), { observer, providerName: 'ollama', parent: () => turn });
  await expect(failing.complete([], { model: 'qwen' })).rejects.toThrow();
  expect(spans[2].status).toBe('error');
});

test('each hook handler run is reported with its time and any failure', async () => {
  const runs: any[] = [];
  const bus = createHookBus({ onRun: (run) => runs.push(run) });
  bus.on('turn_start', () => undefined, 'fine');
  bus.on('turn_start', () => {
    throw new Error('hook broke');
  }, 'broken');
  await bus.emit('turn_start', { session: {} as any, prompt: 'x', messages: [] });
  expect(runs.map((run) => [run.handler, run.error])).toEqual([
    ['fine', undefined],
    ['broken', 'hook broke'],
  ]);
  expect(runs[0].endMs).toBeGreaterThanOrEqual(runs[0].startMs);
});

test('logs past the retention period are removed, and nothing else is', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');
  const old = new Date(now - (LOG_RETENTION_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
  const recent = new Date(now - 86_400_000).toISOString().slice(0, 10);
  for (const name of [`${old}.jsonl`, `${recent}.jsonl`, 'notes.txt']) fs.writeFileSync(path.join(dir, name), '');
  expect(pruneLogs(dir, now)).toEqual([`${old}.jsonl`]);
  expect(fs.readdirSync(dir).sort()).toEqual([`${recent}.jsonl`, 'notes.txt']);
});
