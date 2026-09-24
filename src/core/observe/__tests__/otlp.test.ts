import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { exportTarget, otlpExporter, otlpPayload, parseKeyValues } from '../otlp.js';
import type { SpanData } from '../observer.js';
import { createRuntime } from '../../runtime/index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { JAMCLI_VERSION } from '../../version.js';

/** An OpenTelemetry collector in memory: it keeps every export request it is sent. */
async function startCollector(status = 200) {
  const requests: { headers: http.IncomingHttpHeaders; body: any }[] = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ headers: request.headers, body: JSON.parse(body) });
    response.writeHead(status, { 'content-type': 'application/json' }).end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/traces`;
  const spans = () => requests.flatMap((request) => request.body.resourceSpans[0].scopeSpans[0].spans);
  return { url, requests, spans, close: () => server.close() };
}

const span = (overrides: Partial<SpanData> = {}): SpanData => ({
  traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16),
  name: 'chat qwen',
  kind: 'client',
  startMs: 1_700_000_000_000,
  endMs: 1_700_000_000_250.5,
  status: 'ok',
  attributes: { 'gen_ai.request.model': 'qwen', 'gen_ai.usage.input_tokens': 12, 'jamcli.ratio': 0.5, 'jamcli.flag': true },
  ...overrides,
});

test('spans become an OTLP/HTTP JSON export with hex ids, nanosecond times, and typed attributes', () => {
  const payload = otlpPayload([span(), span({ spanId: 'c'.repeat(16), parentSpanId: 'b'.repeat(16), name: 'turn', kind: 'internal', status: 'error', error: 'broke' })], {
    OTEL_SERVICE_NAME: 'my-agent',
    OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment=dev,team=a%20b',
  }) as any;
  const [resourceSpans] = payload.resourceSpans;
  expect(resourceSpans.resource.attributes).toEqual([
    { key: 'service.name', value: { stringValue: 'my-agent' } },
    { key: 'service.version', value: { stringValue: JAMCLI_VERSION } },
    { key: 'deployment.environment', value: { stringValue: 'dev' } },
    { key: 'team', value: { stringValue: 'a b' } },
  ]);
  expect(resourceSpans.scopeSpans[0].scope).toEqual({ name: 'jamcli', version: JAMCLI_VERSION });
  const [chat, turn] = resourceSpans.scopeSpans[0].spans;
  expect(chat).toEqual({
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    name: 'chat qwen',
    kind: 3,
    startTimeUnixNano: '1700000000000000000',
    endTimeUnixNano: '1700000000250500000',
    attributes: [
      { key: 'gen_ai.request.model', value: { stringValue: 'qwen' } },
      { key: 'gen_ai.usage.input_tokens', value: { intValue: '12' } },
      { key: 'jamcli.ratio', value: { doubleValue: 0.5 } },
      { key: 'jamcli.flag', value: { boolValue: true } },
    ],
    status: { code: 1 },
  });
  expect(turn).toMatchObject({ parentSpanId: 'b'.repeat(16), kind: 1, status: { code: 2, message: 'broke' } });
});

test('the endpoint and headers come from configuration first, then the standard variables', () => {
  const env = { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example:4318/', OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20abc,x-team=a' };
  expect(exportTarget({}, env)).toEqual({ url: 'https://collector.example:4318/v1/traces', headers: { authorization: 'Bearer abc', 'x-team': 'a' } });
  expect(exportTarget({}, { ...env, OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://traces.example/in' }).url).toBe('https://traces.example/in');
  expect(exportTarget({ endpoint: 'http://mine:4318/v1/traces', headers: { 'x-team': 'b' } }, env)).toEqual({
    url: 'http://mine:4318/v1/traces',
    headers: { authorization: 'Bearer abc', 'x-team': 'b' },
  });
  expect(exportTarget({}, {}).url).toBe('http://localhost:4318/v1/traces');
  expect(parseKeyValues('a=1,broken,=x,b=%E0%A4%A')).toEqual({ a: '1' });
});

test('spans are sent in batches and whatever is left at the end; a failing collector is reported once', async () => {
  const collector = await startCollector();
  try {
    const exporter = otlpExporter({ url: collector.url, headers: { authorization: 'Bearer t' }, batchSize: 2, intervalMs: 60_000 });
    exporter.write(span());
    expect(collector.requests).toHaveLength(0);
    exporter.write(span());
    exporter.write(span());
    await exporter.flush!();
    expect(collector.requests.map((request) => request.body.resourceSpans[0].scopeSpans[0].spans.length)).toEqual([2, 1]);
    expect(collector.requests[0].headers).toMatchObject({ authorization: 'Bearer t', 'content-type': 'application/json' });
  } finally {
    collector.close();
  }

  const refusing = await startCollector(503);
  try {
    const errors: string[] = [];
    const exporter = otlpExporter({ url: refusing.url, batchSize: 1, onError: (message) => errors.push(message) });
    exporter.write(span());
    exporter.write(span());
    await exporter.flush!();
    expect(errors).toEqual([`Traces could not be sent to ${refusing.url}: the collector answered 503. Later failures are not reported.`]);
  } finally {
    refusing.close();
  }
});

describe('through a session', () => {
  let server: FakeProviderServer;
  let root: string;
  beforeEach(() => {
    server = startFakeProvider();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-otlp-')));
    fs.writeFileSync(path.join(root, 'notes.txt'), 'the token is tok-abcdef123456\n');
  });
  afterEach(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const run = async (otel: Record<string, unknown> | undefined, env: Record<string, string> = {}) => {
    fs.mkdirSync(path.join(root, '.jamcli'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.jamcli', 'config.json'),
      JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, model: 'ollama:fake-model', ...(otel ? { otel } : {}) })
    );
    const runtime = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false, allowTools: ['read_file'], env: { MY_API_TOKEN: 'tok-abcdef123456', ...env } });
    server.enqueue({ toolCalls: [{ id: 'r1', name: 'read_file', arguments: { path: 'notes.txt' } }], usage: { prompt: 30, completion: 4 } }, { text: 'done reading' });
    await runtime.run('read notes.txt');
    await runtime.close();
  };

  test('nothing is sent unless the exporter is turned on, even with a collector in the environment', async () => {
    const collector = await startCollector();
    try {
      await run(undefined, { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: collector.url });
      await run({ enabled: false, endpoint: collector.url });
      expect(collector.requests).toHaveLength(0);
    } finally {
      collector.close();
    }
  });

  test('a session exports its spans with the GenAI attributes, and no content unless asked', async () => {
    const collector = await startCollector();
    try {
      await run({ enabled: true, endpoint: collector.url });
      const spans = collector.spans();
      const attributes = (name: string) => Object.fromEntries(spans.find((item: any) => item.name === name).attributes.map((entry: any) => [entry.key, Object.values(entry.value)[0]]));
      expect(spans.map((item: any) => item.name).sort()).toEqual(['chat fake-model', 'chat fake-model', 'execute_tool read_file', 'invoke_agent jamcli', 'session']);
      expect(attributes('chat fake-model')).toMatchObject({
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'ollama',
        'gen_ai.request.model': 'fake-model',
        'gen_ai.usage.input_tokens': '30',
        'gen_ai.usage.output_tokens': '4',
      });
      expect(attributes('execute_tool read_file')).toMatchObject({ 'gen_ai.tool.name': 'read_file', 'gen_ai.tool.call.id': 'r1' });
      expect(JSON.stringify(collector.requests)).not.toContain('read notes.txt');
      for (const key of ['gen_ai.input.messages', 'gen_ai.output.messages', 'gen_ai.tool.call.arguments', 'gen_ai.tool.call.result']) {
        expect(JSON.stringify(collector.requests)).not.toContain(key);
      }
    } finally {
      collector.close();
    }
  });

  test('with include_content, prompts, outputs, and tool results are on the spans, redacted', async () => {
    const collector = await startCollector();
    try {
      await run({ enabled: true, endpoint: collector.url, include_content: true });
      const sent = JSON.stringify(collector.requests);
      expect(sent).toContain('gen_ai.input.messages');
      expect(sent).toContain('read notes.txt');
      expect(sent).toContain('done reading');
      expect(sent).toContain('gen_ai.tool.call.result');
      expect(sent).toContain('[redacted:MY_API_TOKEN]');
      expect(sent).not.toContain('tok-abcdef123456');
    } finally {
      collector.close();
    }
  });
});
