import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ENTRY = path.join(import.meta.dir, '../../../index.tsx');

let root: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-draft-process-')));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'config.json'), '{}');
  fs.mkdirSync(path.join(root, 'project'));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** Bun runs a child on a pseudo-terminal when given `terminal`, which the type definitions installed here do not yet describe. */
interface TerminalChild {
  pid: number;
  exitCode: number | null;
  exited: Promise<number>;
  kill(signal?: string): void;
  terminal: { write(text: string): void };
}
const spawnOnTerminal = Bun.spawn as unknown as (command: string[], options: object) => TerminalChild;

/** The real interface in a child process on a pseudo-terminal, as a person's terminal window is. */
async function interfaceProcess() {
  let screen = '';
  const child = spawnOnTerminal(['bun', ENTRY, '--cwd', path.join(root, 'project')], {
    env: { ...process.env, JAMCLI_STATE_DIR: path.join(root, 'state'), JAMCLI_CONFIG_DIR: path.join(root, 'config'), TERM: 'xterm-256color' },
    terminal: { cols: 100, rows: 30, data: (_terminal: unknown, data: Uint8Array) => void (screen += Buffer.from(data).toString()) },
  });
  for (const end = Date.now() + 20_000; Date.now() < end && !screen.includes('Message JamCLI'); ) await Bun.sleep(50);
  expect(screen).toContain('Message JamCLI');
  return { child, type: (text: string) => child.terminal.write(text) };
}

const drafts = () => {
  const dir = path.join(root, 'project', '.jamcli', 'history');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.draft')) : [];
};
const draftText = (name: string) => JSON.parse(fs.readFileSync(path.join(root, 'project', '.jamcli', 'history', name), 'utf8'));

test('a draft typed a moment before the terminal closes is on disk, and the next interface takes it over', async () => {
  const first = await interfaceProcess();
  first.type('typed before the hangup');
  await Bun.sleep(100);
  // Well inside the time the draft may go unwritten while typing: the hang-up is what writes it.
  first.child.kill('SIGHUP');
  await first.child.exited;
  expect(first.child.exitCode).toBe(129);
  expect(drafts()).toHaveLength(1);
  const [left] = drafts();
  expect(draftText(left)).toMatchObject({ pid: first.child.pid, text: 'typed before the hangup' });

  const second = await interfaceProcess();
  try {
    for (const end = Date.now() + 10_000; Date.now() < end && (drafts().length !== 1 || drafts()[0] === left); ) await Bun.sleep(50);
    // The old session's file is gone, and the new session holds the draft under its own name and process.
    expect(drafts()).toHaveLength(1);
    expect(drafts()[0]).not.toBe(left);
    expect(draftText(drafts()[0])).toMatchObject({ pid: second.child.pid, text: 'typed before the hangup' });
  } finally {
    second.child.kill('SIGTERM');
    await second.child.exited;
  }
}, 60_000);
