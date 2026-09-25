import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { pathToFileURL } from 'url';
import { JsonRpcConnection } from '../protocols/jsonrpc/connection.js';
import { contentLengthFraming } from '../protocols/jsonrpc/framing.js';

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  /** 1 error, 2 warning, 3 information, 4 hint. */
  severity?: number;
  message: string;
  source?: string;
  code?: string | number;
}

export interface LspServerSpec {
  command: string;
  args?: string[];
  /** The environment the server runs with: the session's minimal one. */
  env?: Record<string, string | undefined>;
}

export const fileUri = (file: string) => pathToFileURL(file).href;

/**
 * One language server, spoken to over stdio with `Content-Length` framing. It keeps the
 * diagnostics the server publishes, and answers the requests servers commonly make of a
 * client with empty results, so none waits on a feature JamCLI does not have.
 */
export class LspClient {
  private readonly diagnostics = new Map<string, LspDiagnostic[]>();
  /** How many times each file's diagnostics have arrived, so a wait sees a new report. */
  private readonly reports = new Map<string, number>();
  private readonly versions = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private stderr = '';
  exited: Error | undefined;

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly connection: JsonRpcConnection
  ) {}

  static async start(spec: LspServerSpec, root: string, timeoutMs = 20_000): Promise<LspClient> {
    const child = spawn(spec.command, spec.args ?? [], { cwd: root, env: spec.env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
    const connection = new JsonRpcConnection({
      framing: contentLengthFraming,
      write: (bytes) => {
        if (child.stdin.writable) child.stdin.write(bytes);
      },
      requestTimeoutMs: timeoutMs,
    });
    const client = new LspClient(child, connection);
    child.stdout.on('data', (chunk: Buffer) => connection.receive(new Uint8Array(chunk)));
    child.stderr.on('data', (chunk: Buffer) => {
      client.stderr = (client.stderr + chunk.toString()).slice(-4000);
    });
    const failed = new Promise<never>((_, reject) => {
      child.once('error', (error) => {
        client.exited = error;
        connection.close(error.message);
        reject(error);
      });
      child.once('exit', (code) => {
        client.exited = new Error(`${spec.command} exited with code ${code}${client.stderr ? `: ${client.stderr.trim().split('\n').pop()}` : ''}`);
        connection.close(client.exited.message);
        reject(client.exited);
      });
    });
    failed.catch(() => {});

    connection.onNotification('textDocument/publishDiagnostics', (params: { uri: string; diagnostics: LspDiagnostic[] }) => {
      client.diagnostics.set(params.uri, params.diagnostics ?? []);
      client.reports.set(params.uri, (client.reports.get(params.uri) ?? 0) + 1);
      for (const listener of client.listeners) listener();
    });
    connection.onRequest('workspace/configuration', (params: { items?: unknown[] }) => (params?.items ?? []).map(() => null));
    connection.onRequest('client/registerCapability', () => null);
    connection.onRequest('client/unregisterCapability', () => null);
    connection.onRequest('window/workDoneProgress/create', () => null);
    connection.onRequest('workspace/workspaceFolders', () => [{ uri: fileUri(root), name: 'project' }]);
    for (const method of ['window/logMessage', 'window/showMessage', '$/progress', 'telemetry/event']) connection.onNotification(method, () => undefined);

    await Promise.race([
      connection.request('initialize', {
        processId: process.pid,
        clientInfo: { name: 'jamcli' },
        rootUri: fileUri(root),
        workspaceFolders: [{ uri: fileUri(root), name: 'project' }],
        capabilities: {
          textDocument: {
            synchronization: { didSave: false, dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: false },
            hover: { contentFormat: ['plaintext', 'markdown'] },
            definition: {},
            references: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          },
          workspace: { symbol: {} },
        },
      }),
      failed,
    ]);
    connection.notify('initialized', {});
    return client;
  }

  /** Tell the server a file's text: the first time opens it, later times change it. */
  sync(file: string, text: string, languageId: string): void {
    const uri = fileUri(file);
    const version = (this.versions.get(uri) ?? 0) + 1;
    this.versions.set(uri, version);
    if (version === 1) this.connection.notify('textDocument/didOpen', { textDocument: { uri, languageId, version, text } });
    else this.connection.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
  }

  /** The count of diagnostic reports for a file so far, to wait for the next one. */
  reportCount(file: string): number {
    return this.reports.get(fileUri(file)) ?? 0;
  }

  /** The file's diagnostics once a report newer than `after` arrives, or what is known after the timeout. */
  async diagnosticsFor(file: string, after: number, timeoutMs: number): Promise<{ diagnostics: LspDiagnostic[]; fresh: boolean }> {
    const uri = fileUri(file);
    const fresh = () => (this.reports.get(uri) ?? 0) > after;
    if (!fresh()) {
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve();
        };
        const listener = () => {
          if (fresh()) finish();
        };
        const timer = setTimeout(finish, timeoutMs);
        this.listeners.add(listener);
      });
    }
    return { diagnostics: this.diagnostics.get(uri) ?? [], fresh: fresh() };
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 10_000): Promise<T> {
    if (this.exited) return Promise.reject(this.exited);
    return this.connection.request<T>(method, params, { timeoutMs });
  }

  /** Ask the server to shut down, and stop it if it does not. */
  async stop(): Promise<void> {
    if (!this.exited) {
      await this.connection.request('shutdown', null, { timeoutMs: 1000 }).catch(() => undefined);
      this.connection.notify('exit');
    }
    this.connection.close('the language server was stopped');
    await new Promise<void>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return resolve();
      const timer = setTimeout(() => {
        this.child.kill('SIGKILL');
        resolve();
      }, 1000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
