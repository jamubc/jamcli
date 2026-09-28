import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describeGates, detectGates, gateFence, tierOf } from '../gates.js';
import { Ledger } from '../ledger.js';
import { shapeGateOutput } from '../run.js';
import type { TranscriptEvent } from '../../transcript/events.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-gates-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const write = (name: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), text);
};

test('a package.json with a bun lockfile names its typecheck, test, and build scripts through bun', () => {
  write('package.json', JSON.stringify({ scripts: { typecheck: 'tsc --noEmit', test: 'bun test', build: 'bun run build.ts', lint: 'eslint .' } }));
  write('bun.lock', '');
  expect(detectGates(root)).toEqual([
    { name: 'typecheck', tier: 'T1', command: 'bun run typecheck' },
    { name: 'lint', tier: 'T1', command: 'bun run lint' },
    { name: 'test', tier: 'T2', command: 'bun run test' },
    { name: 'build', tier: 'T3', command: 'bun run build' },
  ]);
});

test('a tsconfig without a typecheck script falls back to tsc, and pnpm is read from its lockfile', () => {
  write('package.json', JSON.stringify({ scripts: { test: 'vitest run' } }));
  write('pnpm-lock.yaml', '');
  write('tsconfig.json', '{}');
  expect(detectGates(root)).toEqual([
    { name: 'typecheck', tier: 'T1', command: 'npx tsc --noEmit' },
    { name: 'test', tier: 'T2', command: 'pnpm run test' },
  ]);
});

test('a python project names only the tools its configuration turns on', () => {
  write('pyproject.toml', '[tool.ruff]\nline-length = 100\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
  expect(detectGates(root)).toEqual([
    { name: 'lint', tier: 'T1', command: 'ruff check .' },
    { name: 'test', tier: 'T2', command: 'pytest -x -q' },
  ]);
  write('pyproject.toml', '[project]\nname = "x"\n');
  expect(detectGates(root)).toEqual([]);
});

test('cargo, go, and a Makefile test target each declare their gates', () => {
  write('Cargo.toml', '[package]\nname = "x"\n');
  expect(detectGates(root).map((gate) => gate.command)).toEqual(['cargo check', 'cargo test']);
  fs.rmSync(path.join(root, 'Cargo.toml'));
  write('go.mod', 'module x\n');
  expect(detectGates(root).map((gate) => gate.command)).toEqual(['go vet ./...', 'go test ./...']);
  fs.rmSync(path.join(root, 'go.mod'));
  write('Makefile', 'build:\n\tcc x.c\n\ntest:\n\t./run-tests\n');
  expect(detectGates(root)).toEqual([{ name: 'test', tier: 'T2', command: 'make test' }]);
});

test('an AGENTS.md gate fence is the project\'s own word and outranks the manifests', () => {
  write('package.json', JSON.stringify({ scripts: { test: 'jest' } }));
  write('AGENTS.md', ['# Project', '', '## Four gates, every change', '', '```bash', 'bun install', 'npx tsc --noEmit', 'bun test', 'bun run build', '```', '', '## Other', '```', 'not a gate', '```'].join('\n'));
  expect(detectGates(root)).toEqual([
    { name: 'install', tier: 'T3', command: 'bun install' },
    { name: 'typecheck', tier: 'T1', command: 'npx tsc --noEmit' },
    { name: 'test', tier: 'T2', command: 'bun test' },
    { name: 'build', tier: 'T3', command: 'bun run build' },
  ]);
  expect(gateFence('## Gates\n\ntext without a fence\n')).toEqual([]);
  expect(gateFence(undefined)).toEqual([]);
});

test('tiers are read from what a command says it does', () => {
  expect(tierOf('npx tsc --noEmit')).toBe('T1');
  expect(tierOf('bun test')).toBe('T2');
  expect(tierOf('cargo build --release')).toBe('T3');
  expect(tierOf('sh ./verify.sh')).toBe('T2');
});

test('the prompt line names each runnable gate with its last duration', () => {
  const gates = detectGates(root);
  expect(describeGates(gates, () => undefined)).toBeUndefined();
  write('package.json', JSON.stringify({ scripts: { typecheck: 'tsc', test: 'bun test', build: 'x' } }));
  const line = describeGates(detectGates(root), (name) => (name === 'typecheck' ? 41_200 : undefined))!;
  expect(line).toContain('typecheck `npm run typecheck` (about 41 s)');
  expect(line).toContain('test `npm run test`');
  expect(line).not.toContain('build `');
  expect(line).toContain('runs the typecheck after your edits and the test before a turn ends with edits');
});

test('the ledger is a projection of gate events, keyed by tree', () => {
  const gate = (tree: string, tier: 'T1' | 'T2', status: 'passed' | 'failed' | 'skipped', extra: Record<string, unknown> = {}): TranscriptEvent =>
    ({ v: 2, type: 'gate', ts: 1, tier, name: tier === 'T1' ? 'typecheck' : 'test', command: tier === 'T1' ? 'tsc' : 'bun test', tree, status, durationMs: 1_500, ...extra }) as TranscriptEvent;
  const ledger = Ledger.fromEvents([
    { v: 2, type: 'session', ts: 0, id: 's', projectRoot: '/p', cwd: '/p', surface: 'headless', jamcli: '0' },
    gate('aaaaaaa1', 'T1', 'failed', { step: 3 }),
    gate('bbbbbbb2', 'T1', 'passed', { step: 5 }),
    gate('bbbbbbb2', 'T2', 'skipped'),
    gate('bbbbbbb2', 'T2', 'passed', { byModel: true, step: 6 }),
  ]);
  expect(ledger.passed('aaaaaaa1', 'T1')).toBe(false);
  expect(ledger.has('aaaaaaa1', 'T1')).toBe(true);
  expect(ledger.passed('bbbbbbb2', 'T1')).toBe(true);
  expect(ledger.has('bbbbbbb2', 'T2')).toBe(true);
  expect(ledger.lastDuration('typecheck')).toBe(1_500);
  expect(ledger.tail()).toEqual(['typecheck passed on tree bbbbbbb at step 5', 'test passed on tree bbbbbbb at step 6 (run by the model)']);
});

test('gate output is shaped to a verdict, the lines that name errors, and the tail, under the limit', () => {
  const gate = { name: 'typecheck', tier: 'T1' as const, command: 'tsc' };
  expect(shapeGateOutput(gate, 'passed', 'abcdef0123', 2_340, 'lots\nof\nnoise')).toBe('typecheck passed in 2.3 s on tree abcdef0');
  const output = [...Array.from({ length: 30 }, (_, i) => `src/a.ts(${i + 1},3): error TS2322: bad`), 'Found 30 errors.', 'done'].join('\n');
  const shaped = shapeGateOutput(gate, 'failed', undefined, 500, output);
  expect(shaped.split('\n')[0]).toBe('typecheck failed in 0.5 s on tree no tree');
  expect(shaped).toContain('src/a.ts(1,3): error TS2322: bad');
  expect(shaped).toContain('src/a.ts(20,3): error TS2322: bad');
  expect(shaped).not.toContain('src/a.ts(21,3)');
  expect(shaped).toContain('... 11 more');
  expect(shaped.endsWith('done')).toBe(true);
  const huge = shapeGateOutput(gate, 'failed', 'x', 1, Array.from({ length: 400 }, (_, i) => `error ${'x'.repeat(200)} ${i}`).join('\n'));
  expect(huge.length).toBeLessThanOrEqual(1_500);
});
