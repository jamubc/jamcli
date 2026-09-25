import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { createRuntime, type Runtime } from '../../core/runtime/index.js';
import { startFakeProvider, type FakeProviderServer } from '../../testing/fakeProvider.js';
import { observerPath, startObserver, type ObserverHub } from '../observer.js';
import type { AgentEvent } from '../../core/types.js';

let server: FakeProviderServer;
let root: string;
let previousState: string | undefined;
let runtime: Runtime;
let hub: ObserverHub;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-observer-')));
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, active_profile: 'default', trust: { enabled: false }, sandbox: { enabled: false } }));
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
  runtime = await createRuntime({ projectRoot: root, surface: 'tui', mcp: false });
  hub = await startObserver(path.join(root, 'observer.sock'), runtime);
});
afterEach(async () => {
  await hub.close();
  await runtime.close();
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
});

const waitFor = async (predicate: () => boolean, timeoutMs = 3000): Promise<number> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return Date.now() - started;
    await Bun.sleep(5);
  }
  throw new Error('condition not met in time');
};

/** A raw ACP client on the socket, so every line on the wire is seen. */
const observe = async () => {
  const socket = net.connect(hub.path);
  await new Promise((resolve) => socket.once('connect', resolve));
  const messages: any[] = [];
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) if (line.trim()) messages.push(JSON.parse(line));
  });
  let id = 0;
  const request = async (method: string, params: object) => {
    const mine = ++id;
    socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: mine, method, params })}\n`);
    await waitFor(() => messages.some((message) => message.id === mine));
    return messages.find((message) => message.id === mine);
  };
  const updates = () => messages.filter((message) => message.method === 'session/update').map((message) => message.params.update);
  return { socket, messages, request, updates };
};

test('the endpoint is unix:<path>, user-private, and serves one session that can be loaded but not driven', async () => {
  expect(observerPath('unix:/tmp/x.sock')).toBe('/tmp/x.sock');
  expect(observerPath(undefined)).toBeUndefined();
  expect(() => observerPath('tcp://127.0.0.1:9')).toThrow('JAMCLI_ACP_ENDPOINT must be unix:<path>');
  expect(fs.statSync(hub.path).mode & 0o777).toBe(0o600);
  await expect(startObserver(hub.path, runtime)).rejects.toThrow('is in use by another process');

  const client = await observe();
  expect((await client.request('initialize', { protocolVersion: 1, clientCapabilities: {} })).result.agentCapabilities.loadSession).toBe(true);
  expect((await client.request('session/list', {})).result.sessions).toEqual([{ sessionId: runtime.sessionId, cwd: root }]);
  expect((await client.request('session/new', { cwd: root, mcpServers: [] })).error).toBeDefined();
  expect((await client.request('session/load', { sessionId: runtime.sessionId, cwd: root, mcpServers: [] })).error).toBeUndefined();
  expect((await client.request('session/prompt', { sessionId: runtime.sessionId, prompt: [{ type: 'text', text: 'hi' }] })).error.message).toContain('only observes');
  client.socket.destroy();
});

test('an observer sees the turn, "editing a file", and need input within a second, and the person still decides', async () => {
  const client = await observe();
  await client.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  await client.request('session/load', { sessionId: runtime.sessionId, cwd: root, mcpServers: [] });
  server.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } }] }, { text: 'Edited.' });
  let decide: ((allow: boolean) => void) | undefined;
  const turn = runtime.run('edit it', (event: AgentEvent) => {
    hub.event(event);
    if (event.type === 'approval_request') decide = (allow) => event.decide({ allow });
  });
  await waitFor(() => decide !== undefined);
  const needInput = await waitFor(() => client.updates().some((update) => update.sessionUpdate === 'state_update' && update.state === 'requires_action'), 1000);
  expect(needInput).toBeLessThan(1000);
  expect(client.updates().find((update) => update.sessionUpdate === 'tool_call')).toMatchObject({ toolCallId: 'e1', title: 'edit a.txt', kind: 'edit', locations: [{ path: path.join(root, 'a.txt') }] });
  expect(client.updates()).toContainEqual({ sessionUpdate: 'tool_call_update', toolCallId: 'e1', status: 'pending' });
  // The observer was never asked to approve.
  expect(client.messages.some((message) => message.method === 'session/request_permission')).toBe(false);
  decide!(true);
  expect((await turn).status).toBe('ok');
  await waitFor(() => client.updates().some((update) => update.sessionUpdate === 'state_update' && update.state === 'idle' && update.stopReason === 'end_turn'));
  expect(client.updates().map((update) => update.state).filter(Boolean)).toEqual(['idle', 'running', 'requires_action', 'running', 'idle']);
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('new\n');
  client.socket.destroy();
});

test('a client that dies mid-turn leaves the turn running to its end, and a reload replays it', async () => {
  const client = await observe();
  await client.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  await client.request('session/load', { sessionId: runtime.sessionId, cwd: root, mcpServers: [] });
  server.enqueue({ text: 'first ', delayMs: 50 } as any, { text: 'unused' });
  const turn = runtime.run('say something', (event) => {
    hub.event(event);
    if (event.type === 'turn_start') client.socket.destroy();
  });
  const result = await Promise.race([turn, Bun.sleep(5000).then(() => 'hung' as const)]);
  expect(result).not.toBe('hung');
  expect((result as any).status).toBe('ok');

  const again = await observe();
  await again.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  await again.request('session/load', { sessionId: runtime.sessionId, cwd: root, mcpServers: [] });
  await waitFor(() => again.updates().some((update) => update.sessionUpdate === 'agent_message_chunk'));
  expect(again.updates().filter((update) => update.sessionUpdate === 'user_message_chunk').map((update) => update.content.text)).toEqual(['say something']);
  again.socket.destroy();
});

test('the socket is user-private from the moment it exists, before any chmod', async () => {
  const socketPath = path.join(root, 'window.sock');
  const original = fs.chmodSync;
  const seen: number[] = [];
  (fs as any).chmodSync = (target: string, mode: number) => {
    seen.push(fs.statSync(target).mode & 0o777);
    return original.call(fs, target, mode);
  };
  try {
    const second = await startObserver(socketPath, runtime);
    await second.close();
  } finally {
    (fs as any).chmodSync = original;
  }
  expect(seen).toEqual([0o600]);
});

test('a socket path in a directory others can write is refused', async () => {
  const shared = path.join(root, 'shared');
  fs.mkdirSync(shared, { recursive: true });
  fs.chmodSync(shared, 0o777);
  await expect(startObserver(path.join(shared, 'observer.sock'), runtime)).rejects.toThrow('writable by others');
});

test('a client that stops reading is dropped once its backlog passes the limit', async () => {
  const client = await observe();
  await client.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  await client.request('session/load', { sessionId: runtime.sessionId, cwd: root, mcpServers: [] });
  client.socket.pause();
  // A turn's output larger than the limit, written while the client does not read.
  hub.event({ type: 'text', delta: 'x'.repeat(2_000_000) } as AgentEvent);
  hub.event({ type: 'turn_end', status: 'ok' } as AgentEvent);
  client.socket.resume();
  await waitFor(() => client.socket.destroyed, 10_000);
  expect(client.socket.destroyed).toBe(true);
}, 30_000);

test('after a session is replaced the old watcher hears the replacement, then nothing until it loads the new session', async () => {
  const client = await observe();
  await client.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  await client.request('session/load', { sessionId: runtime.sessionId, cwd: root, mcpServers: [] });

  const next = await createRuntime({ projectRoot: root, surface: 'tui', mcp: false });
  try {
    hub.attach(next);
    await waitFor(() => client.updates().some((update) => update.sessionUpdate === 'session_info_update'));
    const info = client.updates().find((update) => update.sessionUpdate === 'session_info_update');
    expect(info._meta.jamcli).toEqual({ replacedBy: next.sessionId, from: runtime.sessionId });

    // No watcher is attached to the new session yet, so its events reach nobody.
    hub.event({ type: 'turn_start', prompt: 'on the new session' } as AgentEvent);
    await Bun.sleep(150);
    expect(client.updates().some((update) => update.sessionUpdate === 'state_update' && update.state === 'running')).toBe(false);

    // Loading it moves the watcher to the new session.
    expect((await client.request('session/load', { sessionId: next.sessionId, cwd: root, mcpServers: [] })).error).toBeUndefined();
    hub.event({ type: 'turn_start', prompt: 'on the new session' } as AgentEvent);
    await waitFor(() => client.updates().some((update) => update.sessionUpdate === 'state_update' && update.state === 'running'));
  } finally {
    await next.close();
    client.socket.destroy();
  }
}, 20_000);
