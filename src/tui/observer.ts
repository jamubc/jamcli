import fs from 'fs';
import net from 'net';
import path from 'path';
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError, type SessionUpdate } from '@agentclientprotocol/sdk';
import { stopReasonFor, UpdateMapper } from '../acp/updates.js';
import { JAMCLI_VERSION } from '../core/version.js';
import type { AgentEvent } from '../core/types.js';
import type { Runtime } from '../core/runtime/index.js';

/** A client that stops reading is dropped once this much output waits for it. */
const SLOW_CLIENT_BYTES = 1 << 20;

/** Where the observer listens: `unix:<path>`, read from `JAMCLI_ACP_ENDPOINT`. */
export function observerPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^unix:(.+)$/.exec(value.trim());
  if (!match) throw new Error(`JAMCLI_ACP_ENDPOINT must be unix:<path>, not ${value}.`);
  return match[1];
}

/** What the interface tells the observer: every event, and the session on screen. */
export interface ObserverHub {
  event(event: AgentEvent): void;
  attach(runtime: Runtime): void;
  close(): Promise<void>;
  /** For tests and the log: the socket path. */
  readonly path: string;
}

type State = 'running' | 'requires_action' | 'idle';

interface Watcher {
  sessionId: string;
  mapper: UpdateMapper;
  send(update: SessionUpdate | Record<string, unknown>): void;
}

/**
 * Serves standard ACP on a user-private Unix socket beside the interface, so a terminal
 * manager can show what the session on screen is doing. An observer loads the session
 * with `session/load` (or finds it with `session/list`) and then receives its updates.
 * It cannot prompt, approve, or open sessions: the person answers in the interface, and
 * an observer's presence never changes that. Writes never wait for a client, and one that
 * falls behind is dropped.
 */
export async function startObserver(socketPath: string, first: Runtime): Promise<ObserverHub> {
  let runtime = first;
  let state: State = 'idle';
  const watchers = new Set<Watcher>();
  const sockets = new Set<net.Socket>();

  // A directory others can write lets them replace the socket path between the check and
  // the bind, so the socket would not be private.
  const directory = path.dirname(socketPath);
  if (fs.existsSync(directory)) {
    const mode = fs.statSync(directory).mode & 0o777;
    if (mode & 0o022) {
      throw new Error(`${directory} is writable by others (mode ${mode.toString(8)}), so the observer socket would not be private. Put it in a directory only you can write, such as one under the state directory.`);
    }
  }

  // A socket left by a process that is gone is removed; one that answers is in use.
  if (fs.existsSync(socketPath)) {
    const live = await new Promise<boolean>((resolve) => {
      const probe = net.connect(socketPath);
      probe.once('connect', () => (probe.destroy(), resolve(true)));
      probe.once('error', () => resolve(false));
    });
    if (live) throw new Error(`${socketPath} is in use by another process.`);
    fs.rmSync(socketPath, { force: true });
  }

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    serve(socket);
  });
  // Created user-private: the mask covers the moment between bind and chmod.
  const mask = process.umask(0o177);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });
  } finally {
    process.umask(mask);
  }
  fs.chmodSync(socketPath, 0o600);

  function serve(socket: net.Socket) {
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        socket.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        socket.on('close', () => {
          try {
            controller.close();
          } catch {}
        });
      },
    });
    const output = new WritableStream<Uint8Array>({
      write(chunk) {
        if (socket.destroyed) return;
        if (socket.writableLength > SLOW_CLIENT_BYTES) {
          socket.destroy();
          return;
        }
        // Not awaited: the interface never waits on an observer.
        socket.write(chunk);
      },
    });
    let watcher: Watcher | undefined;
    const connection = new AgentSideConnection(
      (client) => ({
        initialize: async () => ({
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
          agentInfo: { name: 'jamcli', version: JAMCLI_VERSION },
          authMethods: [],
        }),
        authenticate: async () => ({}),
        listSessions: async () => ({ sessions: [{ sessionId: runtime.sessionId, cwd: runtime.workRoot }] }),
        loadSession: async (params) => {
          if (params.sessionId !== runtime.sessionId) throw RequestError.resourceNotFound(params.sessionId);
          const mapper = new UpdateMapper(runtime.workRoot);
          const send = (update: SessionUpdate | Record<string, unknown>) =>
            void client.sessionUpdate({ sessionId: watcher?.sessionId ?? runtime.sessionId, update: update as SessionUpdate }).catch(() => {});
          for (const update of mapper.replay(runtime.session.messages)) send(update);
          send({ sessionUpdate: 'state_update', state });
          if (watcher) watchers.delete(watcher);
          watcher = { sessionId: runtime.sessionId, mapper, send };
          watchers.add(watcher);
          return {};
        },
        newSession: async () => {
          throw RequestError.invalidRequest(undefined, 'This endpoint observes the interface\'s session; load it with session/load.');
        },
        prompt: async () => {
          throw RequestError.invalidRequest(undefined, 'This endpoint only observes: prompts are typed in the interface.');
        },
        cancel: async () => {},
      }),
      ndJsonStream(output, input)
    );
    void connection.closed.then(() => {
      if (watcher) watchers.delete(watcher);
    });
  }

  const broadcast = (update: SessionUpdate | Record<string, unknown>) => {
    for (const watcher of watchers) watcher.send(update);
  };
  const setState = (next: State, extra: Record<string, unknown> = {}) => {
    state = next;
    broadcast({ sessionUpdate: 'state_update', state: next, ...extra });
  };

  return {
    path: socketPath,
    event(event) {
      if (!watchers.size && event.type !== 'turn_start' && event.type !== 'turn_end' && event.type !== 'approval_request' && event.type !== 'approval_decision') return;
      try {
        if (event.type === 'turn_start') setState('running');
        for (const watcher of watchers) for (const update of watcher.mapper.map(event)) watcher.send(update);
        if (event.type === 'approval_request') setState('requires_action');
        if (event.type === 'approval_decision' && state === 'requires_action') setState('running');
        if (event.type === 'turn_end') setState('idle', { stopReason: stopReasonFor(event.status) });
      } catch {
        // An observer never disturbs the session.
      }
    },
    attach(next) {
      if (next === runtime) return;
      const from = runtime.sessionId;
      runtime = next;
      state = 'idle';
      // Standard ACP has no word for a replaced session: the old one says so in its info.
      for (const watcher of watchers) {
        watcher.send({ sessionUpdate: 'session_info_update', _meta: { jamcli: { replacedBy: next.sessionId, from } } });
        watchers.delete(watcher);
      }
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(socketPath, { force: true });
    },
  };
}
