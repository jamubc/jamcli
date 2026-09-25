import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fileUri, LspClient, type LspDiagnostic, type LspRange, type LspServerSpec } from './client.js';

export interface LspServerConfig extends LspServerSpec {
  /** File extensions it serves, without the dot. */
  extensions: string[];
  enabled?: boolean;
}

export interface LspSettings {
  /** Off turns the `lsp` tool and diagnostics after edits off. On by default. */
  enabled?: boolean;
  /** Report a changed file's errors to the model after each edit. On by default. */
  diagnostics_after_edit?: boolean;
  /** Servers by name, added to or replacing the defaults. */
  servers?: Record<string, LspServerConfig>;
}

/** Servers used when their command is installed. A configured server of the same name replaces one. */
export const DEFAULT_LSP_SERVERS: Record<string, LspServerConfig> = {
  typescript: { command: 'typescript-language-server', args: ['--stdio'], extensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'] },
  python: { command: 'pyright-langserver', args: ['--stdio'], extensions: ['py', 'pyi'] },
  go: { command: 'gopls', extensions: ['go'] },
  rust: { command: 'rust-analyzer', extensions: ['rs'] },
};

const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascriptreact',
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
};

const extensionOf = (file: string) => path.extname(file).slice(1).toLowerCase();

/** Whether a command can be found on the PATH, or is a path that exists. */
const installed = (command: string, env: Record<string, string | undefined>) =>
  command.includes('/') ? fs.existsSync(command) : Boolean(Bun.which(command, { PATH: env.PATH ?? '' }));

const SEVERITY = ['', 'error', 'warning', 'info', 'hint'];

/** A diagnostic as a line the model reads: `src/a.ts:3:5 error: message (source)`, 1-based. */
export const formatDiagnostic = (file: string, diagnostic: LspDiagnostic) =>
  `${file}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1} ${SEVERITY[diagnostic.severity ?? 1] ?? 'error'}: ${diagnostic.message.split('\n')[0]}${diagnostic.source ? ` (${diagnostic.source})` : ''}`;

/**
 * The language servers of one session, each started the first time a file it serves is
 * asked about, and stopped with the session.
 */
export class LspManager {
  private readonly servers: [string, LspServerConfig][];
  private readonly running = new Map<string, Promise<LspClient>>();

  constructor(
    private readonly root: string,
    settings: LspSettings,
    private readonly env: Record<string, string | undefined>,
    /**
     * The session's sandbox. Some servers run the project's code (rust-analyzer runs build
     * scripts), so they run where commands do.
     */
    private readonly wrap?: (command: string, options: { cwd: string; env: Record<string, string> }) => { file: string; args: string[] }
  ) {
    const merged = { ...DEFAULT_LSP_SERVERS, ...(settings.servers ?? {}) };
    this.servers = Object.entries(merged).filter(([, server]) => server.enabled !== false && installed(server.command, env));
  }

  /** The servers that can run here, by name. */
  get available(): string[] {
    return this.servers.map(([name]) => name);
  }

  /** Whether some server handles this file. */
  serves(file: string): boolean {
    return this.serverFor(file) !== undefined;
  }

  private serverFor(file: string) {
    const extension = extensionOf(file);
    return this.servers.find(([, server]) => server.extensions.includes(extension));
  }

  private async clientFor(file: string): Promise<LspClient> {
    const found = this.serverFor(file);
    if (!found) throw new Error(`No language server handles .${extensionOf(file)} files here. Available: ${this.available.join(', ') || 'none'}.`);
    const [name, server] = found;
    let started = this.running.get(name);
    if (!started) {
      const quote = (value: string) => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`);
      const wrapped = this.wrap?.([server.command, ...(server.args ?? [])].map(quote).join(' '), { cwd: this.root, env: this.env as Record<string, string> });
      started = LspClient.start({ ...(wrapped ? { command: wrapped.file, args: wrapped.args } : server), env: this.env }, this.root);
      this.running.set(name, started);
      // A server that fails to start is tried again on the next request.
      started.catch(() => this.running.delete(name));
    }
    const client = await started;
    if (client.exited) {
      this.running.delete(name);
      throw client.exited;
    }
    return client;
  }

  /** Sync a file from disk and return its diagnostics once the server reports them. */
  async diagnostics(file: string, timeoutMs = 5000): Promise<{ diagnostics: LspDiagnostic[]; fresh: boolean }> {
    const absolute = path.resolve(this.root, file);
    const client = await this.clientFor(absolute);
    const before = client.reportCount(absolute);
    client.sync(absolute, fs.readFileSync(absolute, 'utf8'), LANGUAGES[extensionOf(absolute)] ?? 'plaintext');
    return client.diagnosticsFor(absolute, before, timeoutMs);
  }

  /** A request about a position in a file, after syncing it. Line and character are 0-based. */
  async at<T>(method: string, file: string, line: number, character: number, extra: object = {}): Promise<T> {
    const absolute = path.resolve(this.root, file);
    const client = await this.clientFor(absolute);
    client.sync(absolute, fs.readFileSync(absolute, 'utf8'), LANGUAGES[extensionOf(absolute)] ?? 'plaintext');
    return client.request<T>(method, { textDocument: { uri: fileUri(absolute) }, position: { line, character }, ...extra });
  }

  async symbols(file: string): Promise<any[]> {
    const absolute = path.resolve(this.root, file);
    const client = await this.clientFor(absolute);
    client.sync(absolute, fs.readFileSync(absolute, 'utf8'), LANGUAGES[extensionOf(absolute)] ?? 'plaintext');
    return (await client.request<any[]>('textDocument/documentSymbol', { textDocument: { uri: fileUri(absolute) } })) ?? [];
  }

  /** A location as `path:line:character`, relative to the project when inside it. */
  where(uri: string, range: LspRange): string {
    const file = uri.startsWith('file:') ? fileURLToPath(uri) : uri;
    const shown = path.relative(this.root, file);
    return `${shown && !shown.startsWith('..') ? shown : file}:${range.start.line + 1}:${range.start.character + 1}`;
  }

  async close(): Promise<void> {
    const clients = await Promise.allSettled([...this.running.values()]);
    this.running.clear();
    await Promise.allSettled(clients.flatMap((result) => (result.status === 'fulfilled' ? [result.value.stop()] : [])));
  }
}
