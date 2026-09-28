#!/usr/bin/env bun
/**
 * Run a jamcli trial: each variant of a spec, repeated, on a real model, in a throwaway git
 * worktree of the target project. Every run drives jamcli's own runtime, the core the TUI
 * and headless mode share, then is scored by deterministic checks and, when the spec asks,
 * by a judge that is jamcli itself. Results and the session logs land in the output folder.
 *
 *   bun .claude/skills/jamcli-trials/trial.ts <spec.json> [--variant name] [--repeat n]
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRuntime, type HarnessOverrides } from '../../../src/core/runtime/index.ts';
import { REFLECTION_TOOLS, reflectTurn } from '../../../src/core/reflection/index.ts';
import { readTranscript } from '../../../src/core/transcript/index.ts';
import { score, type Metrics } from '../../../src/core/eval/index.ts';
import type { AgentEvent } from '../../../src/core/types.ts';

type Check =
  | { contains: string }
  | { notContains: string }
  | { regex: string }
  | { fileContains: { path: string; text: string } }
  | { command: string; expectExit?: number };

interface Variant {
  /** Overrides the spec's model for this variant. */
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Tool name to the description offered instead of the tool's own. */
  toolDescriptions?: Record<string, string>;
  /** Agent name to the agent file's full text, written to .jamcli/agents/<name>.md. */
  agents?: Record<string, string>;
  /** Project-relative path to file text, written before the run. */
  files?: Record<string, string>;
  /** Merged into .jamcli/config.local.json. */
  config?: Record<string, unknown>;
  /** Replaces the spec's turns. */
  turns?: string[];
  /** The harness surface: prompt guidance, middleware constants, tool wire schemas, in place of the shipped values. */
  harness?: HarnessOverrides;
}

interface Spec {
  name: string;
  project: string;
  model: string;
  turns: string[];
  variants: Record<string, Variant>;
  repeat?: number;
  allowTools?: string[];
  /** What to answer when the run asks: allow is safe because every run is in a worktree. */
  approve?: 'allow' | 'deny';
  maxSteps?: number;
  checks?: Check[];
  judge?: { model?: string; rubric: string };
  out?: string;
  /**
   * What each run starts from: `head`, the last commit (the default), or `working`, the
   * working copy's tracked changes and untracked files, taken without touching it.
   */
  base?: 'head' | 'working';
}

const JAMCLI = path.resolve(import.meta.dir, '../../..');
const args = process.argv.slice(2);
const specPath = args.find((arg) => !arg.startsWith('--'));
if (!specPath) {
  console.error('Usage: bun .claude/skills/jamcli-trials/trial.ts <spec.json> [--variant name] [--repeat n]');
  process.exit(2);
}
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const spec: Spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const onlyVariant = flag('variant');
const repeat = Number(flag('repeat') ?? spec.repeat ?? 1);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.resolve(spec.out ?? path.join(JAMCLI, '.jamcli', 'trials'), `${spec.name}-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(specPath, path.join(outDir, 'spec.json'));

const git = (cwd: string, ...rest: string[]) => spawnSync('git', rest, { cwd, encoding: 'utf8' });

/**
 * The commit a run starts from. For `working`, `git stash create` records the tracked changes
 * as a commit without touching the working copy or the stash list; untracked files are copied.
 */
const baseCommit = (() => {
  if (spec.base !== 'working') return 'HEAD';
  const stashed = git(spec.project, 'stash', 'create').stdout.trim();
  return stashed || 'HEAD';
})();
const untracked = spec.base === 'working' ? git(spec.project, 'ls-files', '--others', '--exclude-standard').stdout.split('\n').filter(Boolean) : [];

/** A detached worktree of the project, so a run never touches the person's working copy. */
function openWorktree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jamcli-trial-${spec.name}-`));
  fs.rmSync(dir, { recursive: true, force: true });
  const made = git(spec.project, 'worktree', 'add', '--detach', dir, baseCommit);
  if (made.status !== 0) throw new Error(`git worktree add failed: ${made.stderr.trim()}`);
  for (const relative of untracked) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(spec.project, relative), target);
  }
  return dir;
}
const closeWorktree = (dir: string) => {
  git(spec.project, 'worktree', 'remove', '--force', dir);
  fs.rmSync(dir, { recursive: true, force: true });
};

function prepare(dir: string, variant: Variant) {
  const write = (relative: string, text: string) => {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  for (const [relative, text] of Object.entries(variant.files ?? {})) write(relative, text);
  for (const [name, text] of Object.entries(variant.agents ?? {})) write(path.join('.jamcli', 'agents', `${name}.md`), text);
  if (variant.config) write(path.join('.jamcli', 'config.local.json'), JSON.stringify(variant.config, null, 2));
}

interface RunMetrics {
  status: string;
  durationMs: number;
  requests: number;
  toolCalls: Record<string, number>;
  toolErrors: string[];
  denied: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  cost: number;
  response: string;
}

async function runOnce(dir: string, variant: Variant): Promise<{ metrics: RunMetrics; sessionId: string; transcript: string[] }> {
  const runtime = await createRuntime({
    projectRoot: dir,
    surface: 'headless',
    mcp: false,
    model: variant.model ?? spec.model,
    ...(variant.effort ? { effort: variant.effort } : {}),
    ...(variant.toolDescriptions ? { toolDescriptions: variant.toolDescriptions } : {}),
    ...(variant.harness ? { harness: variant.harness } : {}),
    ...(spec.allowTools ? { allowTools: spec.allowTools } : {}),
    ...(spec.maxSteps ? { maxSteps: spec.maxSteps } : {}),
  });
  const metrics: RunMetrics = { status: 'ok', durationMs: 0, requests: 0, toolCalls: {}, toolErrors: [], denied: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, cost: 0, response: '' };
  const transcript: string[] = [];
  const onEvent = (event: AgentEvent) => {
    if (event.type === 'tool_call') {
      metrics.toolCalls[event.call.name] = (metrics.toolCalls[event.call.name] ?? 0) + 1;
      transcript.push(`call ${event.call.name} ${JSON.stringify(event.call.arguments).slice(0, 200)}`);
    }
    if (event.type === 'tool_result') {
      const ok = event.result.success;
      if (event.result.status === 'denied') metrics.denied += 1;
      else if (!ok) metrics.toolErrors.push(`${event.result.tool}: ${String(event.result.output).slice(0, 160)}`);
      transcript.push(`result ${ok ? 'ok' : event.result.status ?? 'error'}: ${String(event.result.output).slice(0, 200).replace(/\n/g, ' | ')}`);
    }
    if (event.type === 'usage') {
      metrics.requests += 1;
      metrics.promptTokens += event.usage.prompt_tokens ?? 0;
      metrics.cachedTokens += event.usage.cached_tokens ?? 0;
      metrics.completionTokens += event.usage.completion_tokens ?? 0;
      metrics.cost += event.cost ?? 0;
    }
    if (event.type === 'approval_request') event.decide({ allow: (spec.approve ?? 'allow') === 'allow', scope: 'once' });
  };
  const started = Date.now();
  try {
    for (const turn of variant.turns ?? spec.turns) {
      transcript.push(`> ${turn}`);
      const reflect = /^\/reflect\b\s*(.*)$/.exec(turn);
      const result = reflect
        ? await runtime.run(reflectTurn(false, reflect[1]), onEvent, { label: '/reflect', offer: REFLECTION_TOOLS })
        : await runtime.run(turn, onEvent);
      metrics.status = result.status;
      metrics.response = result.response;
      transcript.push(`reply: ${result.response}`);
      if (result.status !== 'ok') break;
    }
  } finally {
    metrics.durationMs = Date.now() - started;
    await runtime.close();
  }
  return { metrics, sessionId: runtime.sessionId, transcript };
}

function runChecks(dir: string, response: string): { check: string; pass: boolean; detail?: string }[] {
  return (spec.checks ?? []).map((check) => {
    if ('contains' in check) return { check: `contains ${check.contains}`, pass: response.includes(check.contains) };
    if ('notContains' in check) return { check: `does not contain ${check.notContains}`, pass: !response.includes(check.notContains) };
    if ('regex' in check) return { check: `matches /${check.regex}/`, pass: new RegExp(check.regex, 'm').test(response) };
    if ('fileContains' in check) {
      const file = path.join(dir, check.fileContains.path);
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      return { check: `${check.fileContains.path} contains ${check.fileContains.text}`, pass: text.includes(check.fileContains.text) };
    }
    const ran = spawnSync('sh', ['-c', check.command], { cwd: dir, encoding: 'utf8', timeout: 300_000 });
    const expected = check.expectExit ?? 0;
    return { check: `\`${check.command}\` exits ${expected}`, pass: ran.status === expected, detail: `exit ${ran.status}: ${(ran.stderr || ran.stdout).trim().slice(-300)}` };
  });
}

/** The judge is jamcli too, in an empty folder, asked for a JSON verdict. */
async function judge(transcript: string[]): Promise<{ score: number | null; reason: string }> {
  if (!spec.judge) return { score: null, reason: '' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-trial-judge-'));
  try {
    const runtime = await createRuntime({ projectRoot: dir, surface: 'headless', mcp: false, model: spec.judge.model ?? spec.model, allowTools: [] });
    const prompt = [
      'You are judging one run of a coding agent. Do not use any tools. Reply with only a JSON object: {"score": <integer 1-10>, "reason": "<two sentences>"}.',
      `Rubric:\n${spec.judge.rubric}`,
      `The run, as its transcript (tool calls abbreviated):\n${transcript.join('\n').slice(-24_000)}`,
    ].join('\n\n');
    const result = await runtime.run(prompt, (event) => {
      if (event.type === 'approval_request') event.decide({ allow: false, scope: 'once' });
    });
    await runtime.close();
    const match = /\{[\s\S]*\}/.exec(result.response);
    const parsed = match ? JSON.parse(match[0]) : {};
    return { score: typeof parsed.score === 'number' ? parsed.score : null, reason: String(parsed.reason ?? result.response).slice(0, 400) };
  } catch (error: any) {
    return { score: null, reason: `judge failed: ${error?.message ?? error}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const results: any[] = [];
for (const [name, variant] of Object.entries(spec.variants)) {
  if (onlyVariant && name !== onlyVariant) continue;
  for (let index = 1; index <= repeat; index += 1) {
    const label = `${name}#${index}`;
    process.stdout.write(`running ${label} ... `);
    const dir = openWorktree();
    try {
      prepare(dir, variant);
      const { metrics, sessionId, transcript } = await runOnce(dir, variant);
      const checks = runChecks(dir, metrics.response);
      const verdict = await judge(transcript);
      // The run's own log, and any children's, which name it as delegatedBy.
      const history = path.join(dir, '.jamcli', 'history');
      const kept = path.join(outDir, 'sessions', `${label.replace('#', '-')}.jsonl`);
      fs.mkdirSync(path.dirname(kept), { recursive: true });
      const children: { id: string; models: string[] }[] = [];
      for (const file of fs.existsSync(history) ? fs.readdirSync(history).filter((name) => name.endsWith('.jsonl')) : []) {
        const events = fs.readFileSync(path.join(history, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
        if (file === `${sessionId}.jsonl`) fs.copyFileSync(path.join(history, file), kept);
        else if (events[0]?.delegatedBy === sessionId) {
          fs.copyFileSync(path.join(history, file), path.join(outDir, 'sessions', `${label.replace('#', '-')}.child-${file}`));
          children.push({ id: file.replace('.jsonl', ''), models: [...new Set(events.filter((event) => event.type === 'usage').map((event) => String(event.model)))] });
        }
      }
      fs.writeFileSync(path.join(outDir, 'sessions', `${label.replace('#', '-')}.transcript.txt`), transcript.join('\n'));
      // The trajectory scores, from the log and the checks, as jamcli sessions score computes them.
      const scored: Metrics | undefined = fs.existsSync(kept) ? score(readTranscript(kept), checks) : undefined;
      results.push({ variant: name, run: index, sessionLog: kept, children, ...metrics, checks, judge: verdict, scored });
      const passed = checks.filter((check) => check.pass).length;
      console.log(`${metrics.status}, ${metrics.requests} requests, $${metrics.cost.toFixed(5)}, checks ${passed}/${checks.length}${verdict.score !== null ? `, judge ${verdict.score}` : ''}`);
    } catch (error: any) {
      console.log(`failed: ${error?.message ?? error}`);
      results.push({ variant: name, run: index, status: 'crashed', error: String(error?.message ?? error) });
    } finally {
      closeWorktree(dir);
    }
  }
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);
const rows = Object.keys(spec.variants)
  .filter((name) => !onlyVariant || name === onlyVariant)
  .map((name) => {
    const runs = results.filter((result) => result.variant === name && result.status !== 'crashed');
    const checks = runs.flatMap((run) => run.checks);
    const scores = runs.map((run) => run.judge?.score).filter((score): score is number => typeof score === 'number');
    const scored = runs.map((run) => run.scored).filter((entry): entry is Metrics => Boolean(entry));
    const completed = scored.filter((entry) => entry.success !== false);
    const pct = (value: number) => `${Math.round(value * 100)}%`;
    return {
      variant: name,
      runs: runs.length,
      success: scored.some((entry) => entry.success !== undefined) ? pct(scored.filter((entry) => entry.success).length / scored.length) : '-',
      checks: checks.length ? `${checks.filter((check: any) => check.pass).length}/${checks.length}` : '-',
      judge: scores.length ? mean(scores).toFixed(1) : '-',
      requests: mean(runs.map((run) => run.requests)).toFixed(1),
      tokensPerTask: completed.length ? Math.round(mean(completed.map((entry) => entry.tokensIn + entry.tokensOut))).toLocaleString('en-US') : '-',
      cached: scored.length ? pct(mean(scored.map((entry) => entry.cachedShare))) : '-',
      breaks: scored.length ? mean(scored.map((entry) => entry.cacheBreaks)).toFixed(1) : '-',
      gates: scored.length ? `${mean(scored.map((entry) => entry.gateRuns.length)).toFixed(1)} run, ${mean(scored.map((entry) => entry.gateRuns.filter((gate) => gate.status === 'failed').length)).toFixed(1)} failed` : '-',
      stopsDenied: scored.length ? mean(scored.map((entry) => entry.falseDone)).toFixed(1) : '-',
      toolErrors: mean(runs.map((run) => run.toolErrors.length)).toFixed(1),
      cost: `$${mean(runs.map((run) => run.cost)).toFixed(5)}`,
      seconds: (mean(runs.map((run) => run.durationMs)) / 1000).toFixed(1),
    };
  });
const table = [
  '| variant | runs | success | checks passed | judge (1-10) | requests | tokens per completed task | cached | prefix breaks | gates | stops denied | tool errors | cost | seconds |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((row) => `| ${row.variant} | ${row.runs} | ${row.success} | ${row.checks} | ${row.judge} | ${row.requests} | ${row.tokensPerTask} | ${row.cached} | ${row.breaks} | ${row.gates} | ${row.stopsDenied} | ${row.toolErrors} | ${row.cost} | ${row.seconds} |`),
].join('\n');
const details = results
  .map((result) =>
    [
      `### ${result.variant} #${result.run}: ${result.status}`,
      result.error ? `Error: ${result.error}` : '',
      result.checks?.map((check: any) => `- ${check.pass ? 'pass' : 'FAIL'}: ${check.check}${check.pass || !check.detail ? '' : ` (${check.detail})`}`).join('\n') ?? '',
      result.judge?.reason ? `Judge: ${result.judge.score ?? '?'} - ${result.judge.reason}` : '',
      result.toolErrors?.length ? `Tool errors:\n${result.toolErrors.map((error: string) => `- ${error}`).join('\n')}` : '',
      result.toolCalls ? `Tools: ${Object.entries(result.toolCalls).map(([name, count]) => `${name} ${count}`).join(', ') || 'none'}` : '',
      result.scored?.signals?.length ? `Signals: ${result.scored.signals.map((signal: any) => `[${signal.id}] ${signal.signature}`).join('; ')}` : '',
      result.children?.length ? `Children: ${result.children.map((child: any) => `${child.id} on ${child.models.join(', ') || 'no request'}`).join('; ')}` : '',
      result.sessionLog ? `Log: ${result.sessionLog}` : '',
      result.response ? `\nFinal reply:\n\n${result.response.slice(0, 2000)}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  )
  .join('\n\n');
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
fs.writeFileSync(
  path.join(outDir, 'report.md'),
  `# Trial: ${spec.name}\n\nModel ${spec.model}, project ${spec.project} at ${spec.base === 'working' ? `its working copy (${baseCommit.slice(0, 8)}, ${untracked.length} untracked files)` : 'HEAD'}, ${repeat} run(s) per variant.\n\n${table}\n\n${details}\n`
);
console.log(`\n${table}\n\nReport: ${path.join(outDir, 'report.md')}`);
