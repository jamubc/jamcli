/**
 * Measure JamCLI against the budgets of D24: `bun run bench`, after `bun run build`.
 * `--enforce` exits 1 when an enforced budget is missed, and `--json <file>` keeps the
 * runs. Each measure is the median of five runs.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BUDGETS, failed, judge, report } from './budgets.js';
import { createBuiltinRegistry } from '../../src/core/tools/registry.js';
import { findRipgrep } from '../../src/core/tools/search.js';

const RUNS = 5;
const repo = path.resolve(import.meta.dir, '../..');
const entry = path.join(repo, 'dist', 'index.js');

const run = (args: string[], options: { cwd?: string; env?: Record<string, string | undefined> } = {}) =>
  new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn(process.env.BENCH_RUNTIME ?? process.execPath, [entry, ...args], { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
  });

/** Wall time of `jamcli --version`, from spawn to exit. */
async function version(): Promise<number[]> {
  const times: number[] = [];
  for (let index = 0; index < RUNS; index += 1) {
    const started = performance.now();
    const { code } = await run(['--version']);
    if (code !== 0) throw new Error('jamcli --version failed');
    times.push(performance.now() - started);
  }
  return times;
}

/**
 * From spawning a headless run to its chat request reaching a local Ollama stand-in, with
 * no MCP servers: what JamCLI costs before the provider can start answering.
 */
async function headless(): Promise<number[]> {
  let arrived = 0;
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/api/show') return Response.json({ model_info: { 'llama.context_length': 8192 }, capabilities: ['completion', 'tools'] });
      if (url.pathname === '/api/chat') {
        arrived ||= performance.now();
        const done = { model: 'bench', message: { role: 'assistant', content: 'ok' }, done: true, done_reason: 'stop', prompt_eval_count: 1, eval_count: 1 };
        return new Response(`${JSON.stringify(done)}\n`, { headers: { 'content-type': 'application/x-ndjson' } });
      }
      return new Response('not found', { status: 404 });
    },
  });
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-bench-'));
  try {
    fs.mkdirSync(path.join(base, 'user'));
    fs.writeFileSync(path.join(base, 'user', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: `http://127.0.0.1:${server.port}` } }, model: 'ollama:bench', trust: { enabled: false } }));
    const env = { JAMCLI_CONFIG_DIR: path.join(base, 'user'), JAMCLI_STATE_DIR: path.join(base, 'state'), JAMCLI_CACHE_DIR: path.join(base, 'cache') };
    const times: number[] = [];
    for (let index = 0; index < RUNS; index += 1) {
      const project = fs.mkdtempSync(path.join(base, 'project-'));
      arrived = 0;
      const started = performance.now();
      const { code, stdout } = await run(['-p', 'hi'], { cwd: project, env });
      if (code !== 0 || stdout.trim() !== 'ok' || !arrived) throw new Error(`the headless run failed (exit ${code})`);
      times.push(arrived - started);
    }
    return times;
  } finally {
    server.stop(true);
    fs.rmSync(base, { recursive: true, force: true });
  }
}

/** The grep tool across 20,000 files, as the model would call it. */
async function grep(): Promise<number[] | { skipped: string }> {
  if (!findRipgrep()) return { skipped: 'ripgrep is not installed' };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-bench-grep-'));
  try {
    for (let dir = 0; dir < 200; dir += 1) {
      const folder = path.join(root, `module-${dir}`);
      fs.mkdirSync(folder);
      for (let file = 0; file < 100; file += 1) {
        const body = Array.from({ length: 20 }, (_, line) => `export const value${line} = ${dir * 100 + file + line}; // line ${line}`).join('\n');
        fs.writeFileSync(path.join(folder, `file-${file}.ts`), dir === 150 && file === 42 ? `${body}\nconst needle = true;\n` : body);
      }
    }
    const registry = createBuiltinRegistry();
    const times: number[] = [];
    for (let index = 0; index < RUNS; index += 1) {
      const started = performance.now();
      const result = await registry.execute('grep', { pattern: 'needle' }, { projectRoot: root });
      times.push(performance.now() - started);
      if (!result.success || !result.output.includes('file-42.ts')) throw new Error('grep did not find the planted line');
    }
    return times;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!fs.existsSync(entry)) throw new Error('Run bun run build first; the budgets are for the built command.');
  const runs = { version: await version(), headless: await headless(), grep: await grep() };
  const results = judge(runs);
  process.stdout.write(`${report(results)}\n`);
  const jsonAt = args.indexOf('--json');
  if (jsonAt >= 0 && args[jsonAt + 1]) {
    const record = results.map((result) => ({ id: result.budget.id, verdict: result.verdict, value: result.value, runs: result.runs, limit: result.budget.limit, unit: result.budget.unit, enforced: result.budget.enforced, note: result.note }));
    fs.writeFileSync(args[jsonAt + 1], `${JSON.stringify({ node: process.versions.node, platform: process.platform, cpus: os.cpus().length, results: record }, null, 2)}\n`);
  }
  if (args.includes('--enforce') && failed(results)) {
    process.stderr.write(`An enforced budget was missed: ${results.filter((result) => result.verdict === 'over').map((result) => result.budget.id).join(', ')}.\n`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exit(2);
  });
}

export { BUDGETS };
