import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { analyzeCommand } from '../../permissions/command.js';
import { READ_ONLY_COMMANDS, readOnlyReason } from '../readonly.js';

/**
 * The analyzer against a real shell. Command lines are generated from programs, arguments,
 * quoting, and shell syntax, and each one the analyzer calls read-only is run by `/bin/sh`
 * with every program on `PATH` replaced by a stub that records its name. What the shell
 * actually ran must be read-only programs only, and no file may appear, change, or go.
 * The stubs run nothing further, so what a flag makes a program do is the unit tests' part;
 * this test is about which programs the shell runs, and where it writes.
 */

setDefaultTimeout(120_000);

const EXTERNAL_READERS = [...READ_ONLY_COMMANDS].filter((name) => !['cd', 'pwd', 'true', 'echo'].includes(name));
const DANGEROUS = ['rm', 'sh', 'bash', 'curl', 'tee', 'sed', 'awk', 'perl', 'python3', 'node', 'xargs', 'env', 'chmod', 'mv', 'cp', 'dd', 'touch', 'mkdir', 'nc'];
const PROGRAMS = [...READ_ONLY_COMMANDS, ...DANGEROUS, 'eval', 'exec', 'command', '.', 'source', 'export', 'set', 'alias'];
const ARGS = ['a.txt', 'src', 'src/b.ts', '-l', '-n', '-la', '"a b"', "'c d'", '$x', '${x}', '*.txt', '{a,b}', '..', '../out', '~', 'rm', 'sh', 'status', 'log', 'diff', '-exec', '{}', '\\;', '--pre=sh', '--hostname-bin=sh', '-delete', 'x=1', '-o', 'out', '--', '"$(rm a.txt)"', "'$(rm)'", '\\$(rm)', '\\`rm\\`'];
const JOINERS = [' ; ', ' && ', ' || ', ' | ', ' & ', '\n', ';', '&&', '|', ' |& ', ' ;; '];
const SPECIALS = ['(', ')', '{ ', ' }', ' > f', ' >> f', ' < a.txt', ' 2>&1', ' &> f', '<<X\nX\n', ' #', '\\\n', '$(', '`', '"', "'", '<(', '>(', ' X=1 ', ' !', '\t', ' $(rm a.txt)', ' `rm a.txt`', "\n#\n"];

/** A seeded generator, so every run tries the same lines and a failure can be replayed. */
const random = (seed: number) => () => ((seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32);

function generate(next: () => number): string {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
  // Mostly read-only programs, so a good share of lines is one the analyzer lets through.
  const segment = () => [next() < 0.75 ? pick([...READ_ONLY_COMMANDS]) : pick(PROGRAMS), ...Array.from({ length: Math.floor(next() * 4) }, () => pick(ARGS))].join(' ');
  let line = Array.from({ length: 1 + Math.floor(next() * 3) }, segment).reduce((joined, part) => `${joined}${pick(JOINERS)}${part}`);
  for (let count = Math.floor(next() * 3); count > 0; count -= 1) {
    const at = Math.floor(next() * (line.length + 1));
    line = line.slice(0, at) + pick(SPECIALS) + line.slice(at);
  }
  return line;
}

let base: string;
let bin: string;
let log: string;
const project = () => path.join(base, 'project');

/** Every file under a directory with its contents, to tell whether a run changed anything. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(base, full)] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return out;
}

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-fuzz-')));
  bin = path.join(base, 'bin');
  log = path.join(base, 'ran.log');
  fs.mkdirSync(bin);
  // Each stub records the name it was run by, and does nothing else.
  for (const name of new Set([...EXTERNAL_READERS, ...DANGEROUS])) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nprintf \'%s\\n\' "${0##*/}" >> "$RAN_LOG"\n', { mode: 0o755 });
  }
  fs.mkdirSync(path.join(project(), 'src'), { recursive: true });
  fs.writeFileSync(path.join(project(), 'a.txt'), 'alpha\n');
  fs.writeFileSync(path.join(project(), 'src', 'b.ts'), 'export const b = 1;\n');
  fs.writeFileSync(path.join(base, 'out'), 'outside the project\n');
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

test('every line the analyzer calls read-only runs only read-only programs and writes nothing', () => {
  // FUZZ_SEED tries other lines; the suite always runs the same ones.
  const next = random(Number(process.env.FUZZ_SEED ?? 20260929));
  const violations: { line: string; ran: string[]; changed: string[] }[] = [];
  let claimed = 0;
  for (let index = 0; index < 4_000; index += 1) {
    const line = generate(next);
    if (readOnlyReason(analyzeCommand(line), project()) !== undefined) continue;
    claimed += 1;
    const before = snapshot(base);
    fs.writeFileSync(log, '');
    spawnSync('/bin/sh', ['-c', line], { cwd: project(), env: { PATH: bin, RAN_LOG: log, HOME: project() }, stdio: 'ignore', timeout: 2_000 });
    const ran = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
    fs.rmSync(log);
    const after = snapshot(base);
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((file) => before[file] !== after[file]);
    const strays = ran.filter((name) => !READ_ONLY_COMMANDS.has(name));
    if (strays.length || changed.length) violations.push({ line, ran: strays, changed });
  }
  expect(violations).toEqual([]);
  // The test proves something only when the analyzer lets a fair number of lines through.
  expect(claimed).toBeGreaterThan(300);
});
