import fs from 'fs';
import path from 'path';
import { Terminal } from '@xterm/headless';

/** Keys as a terminal sends them. */
export const KEYS = {
  enter: '\r',
  escape: '\x1b',
  tab: '\t',
  shiftTab: '\x1b[Z',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  home: '\x1b[H',
  end: '\x1b[F',
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  backspace: '\x7f',
  ctrl: (letter: string) => String.fromCharCode(letter.toLowerCase().charCodeAt(0) - 96),
} as const;

const NAMED: Record<string, string> = {
  enter: KEYS.enter,
  return: KEYS.enter,
  escape: KEYS.escape,
  esc: KEYS.escape,
  tab: KEYS.tab,
  'shift+tab': KEYS.shiftTab,
  up: KEYS.up,
  down: KEYS.down,
  left: KEYS.left,
  right: KEYS.right,
  home: KEYS.home,
  end: KEYS.end,
  pageup: KEYS.pageUp,
  pagedown: KEYS.pageDown,
  backspace: KEYS.backspace,
  space: ' ',
};

/**
 * What a key sends, by the name a person would give it: `enter`, `escape`, `shift+tab`,
 * `up`, `pagedown`, `ctrl+c`, or a single character as itself. Undefined for a name that
 * is none of these.
 */
export function keyBytes(name: string): string | undefined {
  const key = name.trim().toLowerCase();
  if (NAMED[key] !== undefined) return NAMED[key];
  const ctrl = /^ctrl\+([a-z])$/.exec(key);
  if (ctrl) return KEYS.ctrl(ctrl[1]);
  return [...name].length === 1 ? name : undefined;
}

/**
 * The command that runs this same JamCLI, as the shipped build's shebang runs it: a
 * compiled binary as itself, otherwise Bun with no `.env` and no `bunfig.toml` from the
 * project, and the entry this process started from.
 */
export function jamcliCommand(entry: string = Bun.main): string[] {
  if (entry.includes('$bunfs')) return [process.execPath];
  return [process.execPath, '--no-env-file', '--config=/dev/null', entry];
}

export interface TerminalSession {
  /** The screen as a person sees it now, line by line, trailing spaces trimmed. */
  screen(): string;
  /** The screen once everything JamCLI wrote so far has been drawn. */
  drawn(): Promise<string>;
  /** The screen once it matches, or an error naming what it last showed. */
  waitFor(match: string | RegExp | ((screen: string) => boolean), timeoutMs?: number): Promise<string>;
  /** Send keys or text as typed. */
  type(text: string): void;
  /** Change the terminal's size, as a person resizing the window does. */
  resize(cols: number, rows: number): void;
  readonly size: { cols: number; rows: number };
  /** Every piece of text the program has written, escape sequences taken out, in order. */
  written(): string;
  /** When the program last wrote anything, in milliseconds since the epoch. */
  lastOutput(): number;
  /** When anything was last typed into it, in milliseconds since the epoch. */
  lastInput(): number;
  /** The exit code, once the program has left. */
  exited: Promise<number>;
  close(): void;
}

export interface OpenTerminalOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  cols?: number;
  rows?: number;
  /** The program to run; JamCLI as the shipped build runs it, when absent. */
  command?: string[];
  /** Keep an asciinema v2 recording of the session here: everything written, typed, and resized. */
  record?: string;
}

/**
 * JamCLI in a pseudo-terminal, read through a headless terminal emulator: the screen is
 * what the emulator shows after every byte the program wrote, and the emulator's own
 * answers to the program's questions (its capabilities, the cursor) go back to it, as a
 * real terminal's would. Nothing in JamCLI knows it is not a person's terminal.
 */
export function openTerminal(args: string[], options: OpenTerminalOptions): TerminalSession {
  const size = { cols: options.cols ?? 120, rows: options.rows ?? 40 };
  const emulator = new Terminal({ cols: size.cols, rows: size.rows, allowProposedApi: true, scrollback: 0 });
  let pending: Promise<void> = Promise.resolve();
  let raw = '';
  let last = Date.now();
  let typed = 0;
  const decoder = new TextDecoder();
  const started = Date.now();
  const record = (kind: 'o' | 'i' | 'r', data: string) => {
    if (options.record) fs.appendFileSync(options.record, `${JSON.stringify([(Date.now() - started) / 1000, kind, data])}\n`);
  };
  if (options.record) {
    fs.mkdirSync(path.dirname(options.record), { recursive: true });
    fs.writeFileSync(options.record, `${JSON.stringify({ version: 2, width: size.cols, height: size.rows, timestamp: Math.floor(started / 1000), env: { TERM: 'xterm-256color' } })}\n`);
  }
  const child = Bun.spawn([...(options.command ?? jamcliCommand()), ...args], {
    cwd: options.cwd,
    env: { ...options.env, TERM: 'xterm-256color' } as Record<string, string>,
    terminal: {
      cols: size.cols,
      rows: size.rows,
      data: (_terminal: unknown, data: Uint8Array) => {
        const bytes = new Uint8Array(data);
        const text = decoder.decode(bytes, { stream: true });
        raw += text;
        last = Date.now();
        record('o', text);
        pending = pending.then(() => new Promise<void>((resolve) => emulator.write(bytes, resolve)));
      },
    },
  } as any);
  const terminal = (child as any).terminal as { write(data: string): void; resize(cols: number, rows: number): void };
  emulator.onData((reply) => terminal.write(reply));
  const screen = () => {
    const buffer = emulator.buffer.active;
    const lines: string[] = [];
    // Cells past the width stay in the emulator's lines after a narrowing resize until overwritten, and are not on screen.
    for (let row = 0; row < size.rows; row += 1) lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true, 0, size.cols) ?? '');
    return lines.join('\n');
  };
  return {
    screen,
    async drawn() {
      await pending;
      return screen();
    },
    async waitFor(match, timeoutMs = 10_000) {
      const test = typeof match === 'string' ? (text: string) => text.includes(match) : match instanceof RegExp ? (text: string) => match.test(text) : match;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        await pending;
        const now = screen();
        if (test(now)) return now;
        if (Date.now() > deadline) throw new Error(`The screen never showed ${String(match)}. It showed:\n${now}`);
        await Bun.sleep(20);
      }
    },
    type: (text) => {
      typed = Date.now();
      record('i', text);
      terminal.write(text);
    },
    resize(cols, rows) {
      size.cols = cols;
      size.rows = rows;
      record('r', `${cols}x${rows}`);
      emulator.resize(cols, rows);
      terminal.resize(cols, rows);
    },
    get size() {
      return { ...size };
    },
    written: () => raw.replace(/\x1b\[[0-9;?>=$ ]*[A-Za-z~]/g, '\n').replace(/\x1b[P\]_][\s\S]*?(\x07|\x1b\\)/g, ''),
    lastOutput: () => last,
    lastInput: () => typed,
    exited: child.exited,
    close: () => {
      child.kill();
      emulator.dispose();
    },
  };
}
