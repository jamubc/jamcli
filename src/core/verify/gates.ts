import fs from 'fs';
import path from 'path';

/**
 * T0 is a language server's diagnostics on one file. T1 is a whole-project static check
 * (typecheck, lint, vet). T2 is the test suite. T3 is a build or an install, which the
 * harness never runs on its own.
 */
export type GateTier = 'T0' | 'T1' | 'T2' | 'T3';

/** A command the project declares about itself, which proves a change good or bad. */
export interface Gate {
  name: string;
  tier: GateTier;
  command: string;
}

const readIfExists = (file: string): string | undefined => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

const readJsonIfExists = (file: string): any => {
  const text = readIfExists(file);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const exists = (root: string, name: string) => fs.existsSync(path.join(root, name));

/** The package runner the lockfile names. */
const packageRunner = (root: string): string =>
  exists(root, 'bun.lock') || exists(root, 'bun.lockb') ? 'bun' : exists(root, 'pnpm-lock.yaml') ? 'pnpm' : exists(root, 'yarn.lock') ? 'yarn' : 'npm';

/** What tier a command line belongs to, by what it says it does. */
export function tierOf(command: string): GateTier {
  const text = command.toLowerCase();
  if (/\b(install|ci)\b/.test(text)) return 'T3';
  if (/\b(tsc|typecheck|type-check|lint|eslint|vet|ruff|mypy|pyright|clippy|check)\b/.test(text)) return 'T1';
  if (/\btests?\b|\bpytest\b|\bjest\b|\bvitest\b/.test(text)) return 'T2';
  if (/\bbuild\b/.test(text)) return 'T3';
  return 'T2';
}

/** A short name for a gate the fence gave no name to: what its command does. */
const nameOf = (command: string, tier: GateTier, index: number): string => {
  const text = command.toLowerCase();
  if (/\btsc\b|typecheck|type-check|pyright|mypy/.test(text)) return 'typecheck';
  if (/\blint\b|eslint|ruff|clippy|\bvet\b/.test(text)) return 'lint';
  if (/\b(install|ci)\b/.test(text)) return 'install';
  if (tier === 'T2') return 'test';
  if (tier === 'T3') return 'build';
  return `gate ${index + 1}`;
};

/**
 * The commands in the first fenced block under a heading that names gates, one per
 * line, comments and blank lines left out. Such a block is the project's own word on
 * how it checks itself, so it outranks anything read from manifests.
 */
export function gateFence(markdown: string | undefined): string[] {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  let underHeading = false;
  let inFence = false;
  const commands: string[] = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (inFence) break;
      underHeading = /gate/i.test(line);
      continue;
    }
    if (!underHeading) continue;
    if (/^\s*```/.test(line)) {
      if (inFence) break;
      inFence = true;
      continue;
    }
    if (!inFence) continue;
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    commands.push(text.replace(/^\$\s+/, ''));
  }
  return commands;
}

/**
 * The gates a project declares, from its manifests only. Nothing is invented: a gate is a
 * script the project names, a tool its configuration turns on, or a line in its
 * AGENTS.md gate fence.
 */
export function detectGates(root: string): Gate[] {
  const fence = gateFence(readIfExists(path.join(root, 'AGENTS.md')));
  if (fence.length) {
    return fence.map((command, index) => {
      const tier = tierOf(command);
      return { name: nameOf(command, tier, index), tier, command };
    });
  }

  const gates: Gate[] = [];
  const pkg = readJsonIfExists(path.join(root, 'package.json'));
  if (pkg && typeof pkg === 'object') {
    const scripts: Record<string, string> = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    const runner = packageRunner(root);
    const has = (name: string) => typeof scripts[name] === 'string' && scripts[name].trim().length > 0;
    const script = (name: string) => `${runner} run ${name}`;
    if (has('typecheck')) gates.push({ name: 'typecheck', tier: 'T1', command: script('typecheck') });
    else {
      const tsc = Object.entries(scripts).find(([, value]) => /\btsc\b/.test(value) && !/\bbuild\b/.test(value));
      if (tsc) gates.push({ name: 'typecheck', tier: 'T1', command: script(tsc[0]) });
      else if (exists(root, 'tsconfig.json')) gates.push({ name: 'typecheck', tier: 'T1', command: 'npx tsc --noEmit' });
    }
    if (has('lint')) gates.push({ name: 'lint', tier: 'T1', command: script('lint') });
    if (has('test')) gates.push({ name: 'test', tier: 'T2', command: script('test') });
    if (has('build')) gates.push({ name: 'build', tier: 'T3', command: script('build') });
  }

  const pyproject = readIfExists(path.join(root, 'pyproject.toml'));
  const setupCfg = readIfExists(path.join(root, 'setup.cfg'));
  if (pyproject !== undefined || setupCfg !== undefined) {
    if (pyproject?.includes('[tool.ruff') || exists(root, 'ruff.toml') || exists(root, '.ruff.toml')) gates.push({ name: 'lint', tier: 'T1', command: 'ruff check .' });
    if (pyproject?.includes('[tool.mypy') || setupCfg?.includes('[mypy]') || exists(root, 'mypy.ini')) gates.push({ name: 'typecheck', tier: 'T1', command: 'mypy .' });
    const pytest = pyproject?.includes('[tool.pytest') || setupCfg?.includes('[tool:pytest]') || exists(root, 'pytest.ini') || exists(root, 'conftest.py') || exists(root, 'tests/conftest.py');
    if (pytest) gates.push({ name: 'test', tier: 'T2', command: 'pytest -x -q' });
  }

  if (exists(root, 'Cargo.toml')) {
    gates.push({ name: 'typecheck', tier: 'T1', command: 'cargo check' }, { name: 'test', tier: 'T2', command: 'cargo test' });
  }
  if (exists(root, 'go.mod')) {
    gates.push({ name: 'lint', tier: 'T1', command: 'go vet ./...' }, { name: 'test', tier: 'T2', command: 'go test ./...' });
  }
  const makefile = readIfExists(path.join(root, 'Makefile'));
  if (makefile && /^test\s*:/m.test(makefile) && !gates.some((gate) => gate.tier === 'T2')) {
    gates.push({ name: 'test', tier: 'T2', command: 'make test' });
  }
  return gates;
}

/** One line per gate, as the system prompt states them. */
export function describeGates(gates: Gate[], lastDuration: (name: string) => number | undefined): string | undefined {
  const runnable = gates.filter((gate) => gate.tier === 'T1' || gate.tier === 'T2');
  if (!runnable.length) return undefined;
  const parts = runnable.map((gate) => {
    const ms = lastDuration(gate.name);
    return `${gate.name} \`${gate.command}\`${ms ? ` (about ${Math.max(1, Math.round(ms / 1000))} s)` : ''}`;
  });
  const first = gates.find((gate) => gate.tier === 'T1');
  const tests = gates.find((gate) => gate.tier === 'T2');
  const runs = [first ? `the ${first.name} after your edits` : undefined, tests ? `the ${tests.name} before a turn ends with edits` : undefined].filter(Boolean).join(' and ');
  return `This project checks itself with: ${parts.join(', ')}. The harness runs ${runs}; a failure comes back to you as a result.`;
}
