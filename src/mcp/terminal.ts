import fs from 'fs';
import net from 'net';
import path from 'path';
import { getStateDir } from '../utils/paths.js';
import { openTerminal, type TerminalSession } from '../terminal/terminal.js';

/** What the interface is doing, as its observer says. */
export type InterfaceState = 'starting' | 'idle' | 'running' | 'requires_action' | 'exited';

/** How long the screen must stay the same before the interface counts as settled. */
const QUIET_MS = 400;

/**
 * The ordinary `jamcli` interface in a pseudo-terminal, for another agent to use. It is
 * the program a person runs, launched as the shipped build launches it; the only thing set
 * is `JAMCLI_ACP_ENDPOINT`, which any person may set, so the interface's observer says
 * what it is doing and when a call waits on a tool that always asks.
 */
export class DrivenTerminal {
  state: InterfaceState = 'starting';
  /** The tool a waiting call is for, whether only the person answers it, and whether it is a question in a chooser rather than a call to allow. */
  waitingOn: { tool: string; alwaysAsks: boolean; question?: boolean } | undefined;
  exitCode: number | undefined;
  private socket: net.Socket | undefined;

  private constructor(
    readonly id: string,
    readonly terminal: TerminalSession,
    readonly recording: string,
    private readonly endpoint: string
  ) {
    void terminal.exited.then((code) => {
      this.exitCode = code;
      this.state = 'exited';
    });
    void this.observe();
  }

  static open(id: string, options: { cwd: string; args?: string[]; cols?: number; rows?: number; env?: Record<string, string | undefined> }): DrivenTerminal {
    // Beside the observer's socket, in a directory only this user can write, as the observer asks.
    const dir = path.join(getStateDir(), 'mcp-terminals');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const endpoint = path.join(dir, `${id}.sock`);
    const recording = path.join(dir, `${id}.cast`);
    const terminal = openTerminal(options.args ?? [], {
      cwd: options.cwd,
      env: { ...(options.env ?? process.env), JAMCLI_ACP_ENDPOINT: `unix:${endpoint}` },
      cols: options.cols ?? 120,
      rows: options.rows ?? 40,
      record: recording,
    });
    return new DrivenTerminal(id, terminal, recording, endpoint);
  }

  /** Whether the interface waits on a call only the person answers. */
  get personWaits(): boolean {
    return this.state === 'requires_action' && Boolean(this.waitingOn?.alwaysAsks);
  }

  /**
   * Wait until the screen shows `text`, or, without it, until the interface is not working
   * and the screen has been still a moment; or until `ms` pass. Resolves to the screen.
   */
  async settle(ms: number, text?: string, signal?: AbortSignal): Promise<string> {
    const deadline = Date.now() + ms;
    for (;;) {
      const screen = await this.terminal.drawn();
      if (text !== undefined ? screen.includes(text) : this.state !== 'running' && this.state !== 'starting' && Date.now() - Math.max(this.terminal.lastOutput(), this.terminal.lastInput()) >= QUIET_MS) return screen;
      if (this.state === 'exited' || Date.now() >= deadline || signal?.aborted) return screen;
      await Bun.sleep(50);
    }
  }

  close(): void {
    this.socket?.destroy();
    this.terminal.close();
  }

  /** Watch the interface's observer: its state, and what a waiting call is for. */
  private async observe(): Promise<void> {
    for (let tries = 0; tries < 200 && !fs.existsSync(this.endpoint); tries += 1) {
      if (this.state === 'exited') return;
      await Bun.sleep(50);
    }
    if (!fs.existsSync(this.endpoint)) {
      // No observer: the screen alone says when the interface has settled.
      if (this.state === 'starting') this.state = 'idle';
      return;
    }
    // Plain JSON-RPC: the observer's state updates are JamCLI's own, which a strict ACP client drops.
    const socket = net.createConnection(this.endpoint);
    this.socket = socket;
    let id = 0;
    const answers = new Map<number, (message: any) => void>();
    const request = (method: string, params: object) =>
      new Promise<any>((resolve) => {
        id += 1;
        answers.set(id, resolve);
        socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    const load = async () => {
      const listed = await request('session/list', {});
      const session = listed.result?.sessions?.[0];
      if (session) await request('session/load', { sessionId: session.sessionId, cwd: session.cwd, mcpServers: [] });
    };
    let buffered = '';
    socket.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: any;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id !== undefined && answers.has(message.id)) {
          answers.get(message.id)!(message);
          answers.delete(message.id);
        }
        const update = message.method === 'session/update' ? message.params?.update : undefined;
        if (update?.sessionUpdate === 'state_update') {
          this.state = update.state;
          this.waitingOn = update.state === 'requires_action' ? update._meta?.jamcli : undefined;
        }
        // The interface opened another session, as /clear or /resume do: watch that one.
        if (update?.sessionUpdate === 'session_info_update' && update._meta?.jamcli?.replacedBy) void load();
      }
    });
    socket.on('error', () => undefined);
    await new Promise<void>((resolve) => socket.once('connect', resolve).once('error', () => resolve()));
    await request('initialize', { protocolVersion: 1, clientCapabilities: {} });
    await load();
    if (this.state === 'starting') this.state = 'idle';
  }
}
