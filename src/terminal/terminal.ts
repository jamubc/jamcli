import path from 'path';
import { Terminal } from '@xterm/headless';

const ENTRY = path.join(import.meta.dir, '..', 'index.tsx');

/** Keys as a terminal sends them. */
export const KEYS = {
  enter: '\r',
  escape: '\x1b',
  tab: '\t',
  shiftTab: '\x1b[Z',
  up: '\x1b[A',
  down: '\x1b[B',
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  ctrl: (letter: string) => String.fromCharCode(letter.toLowerCase().charCodeAt(0) - 96),
} as const;

export interface TerminalSession {
  /** The screen as a person sees it now, line by line, trailing spaces trimmed. */
  screen(): string;
  /** The screen once it matches, or an error naming what it last showed. */
  waitFor(match: string | RegExp | ((screen: string) => boolean), timeoutMs?: number): Promise<string>;
  /** Send keys or text as typed. */
  type(text: string): void;
  /** Every piece of text the program has written, escape sequences taken out, in order. */
  written(): string;
  /** The exit code, once the program has left. */
  exited: Promise<number>;
  close(): void;
}

/**
 * JamCLI in a pseudo-terminal, read through a headless terminal emulator: the screen is
 * what the emulator shows after every byte the program wrote, and the emulator's own
 * answers to the program's questions (its capabilities, the cursor) go back to it, as a
 * real terminal's would.
 */
export function openTerminal(args: string[], options: { cwd: string; env: Record<string, string | undefined>; cols?: number; rows?: number }): TerminalSession {
  const cols = options.cols ?? 120;
  const rows = options.rows ?? 40;
  const emulator = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 0 });
  let pending: Promise<void> = Promise.resolve();
  let raw = '';
  const decoder = new TextDecoder();
  const child = Bun.spawn(['bun', '--no-env-file', ENTRY, ...args], {
    cwd: options.cwd,
    env: { ...options.env, TERM: 'xterm-256color' } as Record<string, string>,
    terminal: {
      cols,
      rows,
      data: (_terminal: unknown, data: Uint8Array) => {
        const bytes = new Uint8Array(data);
        raw += decoder.decode(bytes, { stream: true });
        pending = pending.then(() => new Promise<void>((resolve) => emulator.write(bytes, resolve)));
      },
    },
  } as any);
  const terminal = (child as any).terminal as { write(data: string): void };
  emulator.onData((reply) => terminal.write(reply));
  const screen = () => {
    const buffer = emulator.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < rows; row += 1) lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '');
    return lines.join('\n');
  };
  return {
    screen,
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
    type: (text) => terminal.write(text),
    written: () => raw.replace(/\x1b\[[0-9;?>=$ ]*[A-Za-z~]/g, '\n').replace(/\x1b[P\]_][\s\S]*?(\x07|\x1b\\)/g, ''),
    exited: child.exited,
    close: () => {
      child.kill();
      emulator.dispose();
    },
  };
}
