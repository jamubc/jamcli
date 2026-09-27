import { afterEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { jamcliCommand, keyBytes, KEYS, openTerminal, type TerminalSession } from '../terminal.js';

let open: TerminalSession | undefined;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-terminal-'));
afterEach(() => open?.close());

test('JamCLI is launched as the shipped build launches it, and a compiled binary as itself', () => {
  expect(jamcliCommand('/repo/dist/index.js')).toEqual([process.execPath, '--no-env-file', '--config=/dev/null', '/repo/dist/index.js']);
  expect(jamcliCommand('/$bunfs/root/jamcli')).toEqual([process.execPath]);
});

test('keys are named as a person would name them', () => {
  expect(keyBytes('enter')).toBe('\r');
  expect(keyBytes('Escape')).toBe('\x1b');
  expect(keyBytes('shift+tab')).toBe(KEYS.shiftTab);
  expect(keyBytes('ctrl+c')).toBe('\x03');
  expect(keyBytes('1')).toBe('1');
  expect(keyBytes('nonsense')).toBeUndefined();
});

test('a program in the terminal is seen as a person sees it, resized, and recorded', async () => {
  const record = path.join(dir, 'session.cast');
  open = openTerminal([], {
    cwd: dir,
    env: process.env,
    cols: 60,
    rows: 10,
    command: ['sh', '-c', 'printf "size %s\\n" "$(tput cols)"; read line; printf "got %s\\n" "$line"; sleep 0.3; printf "now %s\\n" "$(tput cols)"'],
    record,
  });
  await open.waitFor('size 60');
  open.type('hello\r');
  await open.waitFor('got hello');
  open.resize(40, 8);
  await open.waitFor('now 40');
  expect(await open.exited).toBe(0);
  const lines = fs.readFileSync(record, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  expect(lines[0]).toMatchObject({ version: 2, width: 60, height: 10 });
  expect(lines.some((event) => event[1] === 'i' && event[2] === 'hello\r')).toBe(true);
  expect(lines.some((event) => event[1] === 'r' && event[2] === '40x8')).toBe(true);
  expect(lines.filter((event) => event[1] === 'o').map((event) => event[2]).join('')).toContain('got hello');
});
