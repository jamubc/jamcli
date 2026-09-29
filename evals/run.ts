/**
 * Run the task corpus through the real program and score it:
 *
 *   bun evals/run.ts [--model opencode-go:deepseek-v4.1-flash] [--tasks a,b] [--concurrency 2]
 *                    [--config-dir ~/.config/jamcli] [--timeout 600] [--out evals/scores]
 *
 * Each task runs `jamcli -p` in a fresh copy of its project, with a state directory of its own
 * and a copy of the configuration directory, so nothing a run saves reaches the person's own.
 * The copies live under `~/.cache/jamcli-evals/` (or `JAMCLI_EVAL_WORK`): outside any checkout,
 * so no ancestor's `.jamcli/` becomes the project, and outside the temporary directory, which the
 * sandbox may write, so a file beside the project is one the project's commands cannot reach.
 * The check decides the task; the session's log is scored as well.
 */
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { score, type Metrics } from '../src/core/eval/index.js';
import { SessionLog } from '../src/core/transcript/index.js';
import { resolveJamcliProjectRoot } from '../src/utils/projectRoot.js';
import { EVALS_DIR, answered, changedFiles, loadTasks, prepare, runCheck, touchedProtected, type Task } from './tasks.js';

const REPO = path.dirname(EVALS_DIR);
const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const model = flag('model', 'opencode-go:deepseek-v4.1-flash')!;
const only = flag('tasks')?.split(',');
const concurrency = Number(flag('concurrency', '2'));
const timeoutMs = Number(flag('timeout', '600')) * 1000;
const configDir = flag('config-dir', process.env.JAMCLI_CONFIG_DIR ?? path.join(os.homedir(), '.config', 'jamcli'))!;
const outDir = path.resolve(flag('out', path.join(EVALS_DIR, 'scores'))!);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const workRoot = path.join(process.env.JAMCLI_EVAL_WORK ?? path.join(os.homedir(), '.cache', 'jamcli-evals'), runId);
const jamcli = [process.execPath, '--no-env-file', '--config=/dev/null', path.join(REPO, 'src', 'index.tsx')];

interface TaskScore {
  id: string;
  kind: Task['spec']['kind'];
  passed: boolean;
  reasons: string[];
  status?: string;
  exitCode: number | null;
  durationMs: number;
  turns?: number;
  costUsd?: number;
  denials: number;
  changed: string[];
  metrics?: Metrics;
}

/** One headless run, its result object parsed from the last line of its output. */
function runJamcli(task: Task, project: string, base: string): Promise<{ exitCode: number | null; result?: Record<string, any>; stderr: string }> {
  const env = { ...process.env, JAMCLI_STATE_DIR: path.join(base, 'state'), JAMCLI_CONFIG_DIR: path.join(base, 'config'), JAMCLI_CACHE_DIR: path.join(base, 'cache') };
  const argv = [...jamcli.slice(1), '-p', task.spec.prompt, '--output-format', 'json', '--permission-mode', task.spec.mode, '--model', model];
  return new Promise((resolve) => {
    const child = spawn(jamcli[0]!, argv, { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      const last = stdout.trim().split('\n').at(-1) ?? '';
      let result: Record<string, any> | undefined;
      try {
        result = JSON.parse(last);
      } catch {
        result = undefined;
      }
      resolve({ exitCode, result, stderr: stderr.slice(-2_000) });
    });
  });
}

/** The session's log, read while the state directory it lives in is the one in force. */
function sessionEvents(base: string, project: string, sessionId: string) {
  const previous = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(base, 'state');
  try {
    return SessionLog.open(project, sessionId).events();
  } catch {
    return undefined;
  } finally {
    if (previous === undefined) delete process.env.JAMCLI_STATE_DIR;
    else process.env.JAMCLI_STATE_DIR = previous;
  }
}

async function runTask(task: Task): Promise<TaskScore> {
  const base = path.join(workRoot, task.id);
  const project = prepare(task, base);
  // A run whose project resolved to some ancestor would work, and save, in that ancestor.
  if (resolveJamcliProjectRoot(project) !== project) throw new Error(`${project} does not resolve as its own project root; refusing to run there.`);
  fs.cpSync(configDir, path.join(base, 'config'), { recursive: true });
  const started = Date.now();
  const run = await runJamcli(task, project, base);
  const durationMs = Date.now() - started;
  const reasons: string[] = [];
  const result = run.result;
  if (!result) reasons.push(`no result object; stderr: ${run.stderr.trim().split('\n').at(-1) ?? ''}`);
  else if (result.status !== 'ok') reasons.push(`the run ended ${result.status}${result.error ? `: ${result.error}` : ''}`);
  const check = runCheck(task, project);
  if (!check.pass) reasons.push(`the check failed: ${check.output.trim().split('\n').slice(-3).join(' | ')}`);
  const touched = touchedProtected(task, project);
  if (touched.length) reasons.push(`it changed what the task protects: ${touched.join(', ')}`);
  const changed = changedFiles(project);
  if (task.spec.kind === 'answer') {
    if (!answered(task, String(result?.response ?? ''))) reasons.push(`the reply does not name ${task.spec.answer!.join(', ')}`);
    if (changed.length) reasons.push(`a question changed files: ${changed.join(', ')}`);
  }
  const events = result?.session_id ? sessionEvents(base, project, result.session_id) : undefined;
  const metrics = events ? score(events, [{ check: task.spec.check ?? 'answer', pass: reasons.length === 0 }]) : undefined;
  return {
    id: task.id,
    kind: task.spec.kind,
    passed: reasons.length === 0,
    reasons,
    ...(result?.status ? { status: result.status } : {}),
    exitCode: run.exitCode,
    durationMs,
    ...(typeof result?.turns === 'number' ? { turns: result.turns } : {}),
    ...(typeof result?.total_cost_usd === 'number' ? { costUsd: result.total_cost_usd } : {}),
    denials: Array.isArray(result?.permission_denials) ? result.permission_denials.length : 0,
    changed,
    ...(metrics ? { metrics } : {}),
  };
}

async function main() {
  const tasks = loadTasks().filter((task) => !only || only.includes(task.id));
  fs.mkdirSync(workRoot, { recursive: true });
  const scores: TaskScore[] = [];
  const queue = [...tasks];
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async () => {
      for (let task = queue.shift(); task; task = queue.shift()) {
        const scored = await runTask(task);
        scores.push(scored);
        process.stdout.write(`${scored.passed ? 'pass' : 'FAIL'}  ${task.id}  ${Math.round(scored.durationMs / 1000)}s${scored.reasons.length ? `  ${scored.reasons.join('; ')}` : ''}\n`);
      }
    })
  );
  scores.sort((a, b) => a.id.localeCompare(b.id));
  const passed = scores.filter((entry) => entry.passed).length;
  const durations = scores.map((entry) => entry.durationMs).sort((a, b) => a - b);
  const summary = {
    date: new Date().toISOString(),
    model,
    jamcli: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(),
    platform: process.platform,
    tasks: scores.length,
    passed,
    passRate: scores.length ? Math.round((passed / scores.length) * 1000) / 1000 : 0,
    costUsd: Math.round(scores.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0) * 10_000) / 10_000,
    tokensIn: scores.reduce((sum, entry) => sum + (entry.metrics?.tokensIn ?? 0), 0),
    tokensOut: scores.reduce((sum, entry) => sum + (entry.metrics?.tokensOut ?? 0), 0),
    medianSeconds: durations.length ? Math.round(durations[Math.floor(durations.length / 2)]! / 1000) : 0,
    scores,
  };
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${summary.date.slice(0, 10)}-${model.replace(/[^a-z0-9.-]+/gi, '_')}.json`);
  fs.writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`\n${passed}/${scores.length} passed on ${model} at ${summary.jamcli}; $${summary.costUsd}; median ${summary.medianSeconds}s. Wrote ${path.relative(REPO, file)}.\n`);
  process.exit(passed === scores.length ? 0 : 1);
}

await main();
