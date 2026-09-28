#!/usr/bin/env bun
/**
 * The harness search loop: run the baseline on the dev tasks, cluster what went wrong,
 * route each cluster to the surface that owns it, ask a proposer for candidates on that
 * surface, run them, and accept the best only when the dev split shows a lift the
 * held-out split confirms. Optimizer-agnostic: the proposer is a module.
 *
 *   bun scripts/harness-search/loop.ts --tasks <dir> [--cycles 1] [--repeat 3] [--proposer ./propose-llm.ts] [--out .jamcli/harness-search]
 *
 * `<dir>/dev/*.json` and `<dir>/held/*.json` are jamcli-trials specs, one task each, with
 * deterministic checks. The loop never reads the held-out split except at acceptance.
 * Nothing here changes the product: an accepted candidate is printed for a person to
 * land as a commit.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { cluster, route, type Cluster, type Surface } from '../../src/core/eval/index.ts';
import { readTranscript } from '../../src/core/transcript/index.ts';
import type { HarnessOverrides } from '../../src/core/runtime/index.ts';

export interface Candidate {
  name: string;
  surface: Surface;
  harness: HarnessOverrides;
  /** Why the proposer thinks it helps, for the history. */
  rationale?: string;
}

export interface RunScore {
  task: string;
  repeat: number;
  success: boolean;
  tokens: number;
  cachedShare: number;
}

export interface ProposerInput {
  clusters: Cluster[];
  surfaces: Surface[];
  history: HistoryEntry[];
  /** The shipped values the candidate replaces, for the proposer to start from. */
  baseline: HarnessOverrides;
}

export interface HistoryEntry {
  cycle: number;
  candidate: Candidate;
  dev: Lift;
  held?: Lift;
  accepted: boolean;
  reason: string;
}

export interface Lift {
  success: { baseline: number; candidate: number; relLift: number; ciLower: number; ciUpper: number };
  tokensPerCompleted: { baseline: number; candidate: number; relLift: number };
  cachedShare: { baseline: number; candidate: number; delta: number };
}

const JAMCLI = path.resolve(import.meta.dir, '../..');
const TRIAL = path.join(JAMCLI, '.claude/skills/jamcli-trials/trial.ts');
const MAX_CANDIDATES = 4;
const BOOTSTRAP = 1_000;

const flag = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

/** Run one variant of one task spec through the trial driver, and read its results back. */
export function runTask(specFile: string, variantName: string, harness: HarnessOverrides | undefined, repeat: number, outDir: string): { scores: RunScore[]; sessionLogs: string[] } {
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const task = path.basename(specFile, '.json');
  const derived = { ...spec, name: `${task}-${variantName}`, variants: { [variantName]: harness ? { harness } : {} }, out: outDir };
  const derivedFile = path.join(outDir, 'specs', `${task}-${variantName}.json`);
  fs.mkdirSync(path.dirname(derivedFile), { recursive: true });
  fs.writeFileSync(derivedFile, JSON.stringify(derived, null, 2));
  const ran = spawnSync('bun', [TRIAL, derivedFile, '--repeat', String(repeat)], { cwd: JAMCLI, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const reportLine = ran.stdout.split('\n').find((line) => line.startsWith('Report: '));
  if (!reportLine) throw new Error(`trial ${derivedFile} produced no report: ${ran.stdout.slice(-500)}`);
  const folder = path.dirname(reportLine.slice('Report: '.length).trim());
  const results = JSON.parse(fs.readFileSync(path.join(folder, 'results.json'), 'utf8')) as any[];
  const scores: RunScore[] = results.map((result) => ({
    task,
    repeat: result.run,
    success: Boolean(result.scored?.success ?? (result.checks ?? []).every((check: any) => check.pass)),
    tokens: (result.scored?.tokensIn ?? result.promptTokens ?? 0) + (result.scored?.tokensOut ?? result.completionTokens ?? 0),
    cachedShare: result.scored?.cachedShare ?? 0,
  }));
  return { scores, sessionLogs: results.map((result) => result.sessionLog).filter(Boolean) };
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

/** Paired by task and repeat: the candidate's run against the baseline's, so task difficulty cancels. */
function pairs(baseline: RunScore[], candidate: RunScore[]): [RunScore, RunScore][] {
  const out: [RunScore, RunScore][] = [];
  for (const base of baseline) {
    const other = candidate.find((run) => run.task === base.task && run.repeat === base.repeat);
    if (other) out.push([base, other]);
  }
  return out;
}

/** A deterministic pseudo-random sequence, so a lift is the same number on every read of the same runs. */
function* lcg(seed: number): Generator<number> {
  let state = seed >>> 0;
  for (;;) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    yield state / 2 ** 32;
  }
}

export function lift(baseline: RunScore[], candidate: RunScore[]): Lift {
  const paired = pairs(baseline, candidate);
  const successDiff = paired.map(([base, cand]) => Number(cand.success) - Number(base.success));
  const baseSuccess = mean(paired.map(([base]) => Number(base.success)));
  const candSuccess = mean(paired.map(([, cand]) => Number(cand.success)));
  const random = lcg(paired.length * 7 + 1);
  const resamples: number[] = [];
  for (let i = 0; i < BOOTSTRAP && paired.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < paired.length; j += 1) sum += successDiff[Math.floor(random.next().value * paired.length)];
    resamples.push(sum / paired.length / Math.max(baseSuccess, 1e-9));
  }
  resamples.sort((a, b) => a - b);
  const at = (share: number) => resamples[Math.min(resamples.length - 1, Math.max(0, Math.floor(share * resamples.length)))] ?? 0;
  const completed = (runs: RunScore[]) => mean(runs.filter((run) => run.success).map((run) => run.tokens));
  const baseTokens = completed(paired.map(([base]) => base));
  const candTokens = completed(paired.map(([, cand]) => cand));
  const baseCached = mean(paired.map(([base]) => base.cachedShare));
  const candCached = mean(paired.map(([, cand]) => cand.cachedShare));
  return {
    success: { baseline: baseSuccess, candidate: candSuccess, relLift: baseSuccess ? (candSuccess - baseSuccess) / baseSuccess : candSuccess, ciLower: at(0.025), ciUpper: at(0.975) },
    tokensPerCompleted: { baseline: baseTokens, candidate: candTokens, relLift: baseTokens ? (candTokens - baseTokens) / baseTokens : 0 },
    cachedShare: { baseline: baseCached, candidate: candCached, delta: candCached - baseCached },
  };
}

/** Whether a dev lift is worth a held-out run: success up with confidence, or unchanged with tokens well down, never at the cache's expense. */
export function worthHolding(entry: Lift): { ok: boolean; reason: string } {
  if (entry.tokensPerCompleted.relLift > 0.1) return { ok: false, reason: 'tokens per completed task rose more than 10%' };
  if (entry.cachedShare.delta < -0.05) return { ok: false, reason: 'cached share fell more than 5 points' };
  if (entry.success.ciLower > 0) return { ok: true, reason: 'success rose with the confidence interval above zero' };
  if (entry.success.ciLower <= 0 && entry.success.ciUpper >= 0 && entry.tokensPerCompleted.relLift <= -0.15) return { ok: true, reason: 'success unchanged within the interval and tokens down 15% or more' };
  return { ok: false, reason: 'no lift the interval supports' };
}

/** A candidate must not name any task: no path, check text, or prompt of the dev split in its text. */
export function lint(candidate: Candidate, taskFiles: string[]): string | undefined {
  const text = JSON.stringify(candidate.harness);
  if (text.length > 6_000) return 'the candidate is over 6,000 characters';
  for (const file of taskFiles) {
    const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
    const forbidden: string[] = [spec.project, ...(spec.turns ?? []), ...(spec.checks ?? []).flatMap((check: any) => Object.values(check).flatMap((value) => (typeof value === 'string' ? [value] : typeof value === 'object' && value ? Object.values(value).filter((v): v is string => typeof v === 'string') : [])))];
    const hit = forbidden.filter((entry) => typeof entry === 'string' && entry.length > 8 && text.includes(entry));
    if (hit.length) return `the candidate names a dev task: ${hit[0].slice(0, 60)}`;
  }
  return undefined;
}

async function main() {
  const tasksDir = flag('tasks');
  if (!tasksDir) {
    console.error('Usage: bun scripts/harness-search/loop.ts --tasks <dir> [--cycles 1] [--repeat 3] [--proposer ./propose-llm.ts] [--out .jamcli/harness-search]');
    process.exit(2);
  }
  const cycles = Number(flag('cycles', '1'));
  const repeat = Number(flag('repeat', '3'));
  const outDir = path.resolve(flag('out', path.join(JAMCLI, '.jamcli', 'harness-search'))!);
  const proposerFile = path.resolve(import.meta.dir, flag('proposer', './propose-llm.ts')!);
  const { propose } = (await import(proposerFile)) as { propose: (input: ProposerInput) => Promise<Candidate[]> };
  const specsIn = (split: string) => (fs.existsSync(path.join(tasksDir, split)) ? fs.readdirSync(path.join(tasksDir, split)).filter((name) => name.endsWith('.json')).map((name) => path.join(tasksDir, split, name)) : []);
  const dev = specsIn('dev');
  const held = specsIn('held');
  if (!dev.length) throw new Error(`no dev tasks under ${tasksDir}/dev`);
  const historyFile = path.join(outDir, 'history.json');
  const history: HistoryEntry[] = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : [];
  fs.mkdirSync(outDir, { recursive: true });
  const runAll = (files: string[], name: string, harness?: HarnessOverrides) => {
    const scores: RunScore[] = [];
    const logs: string[] = [];
    for (const file of files) {
      const ran = runTask(file, name, harness, repeat, outDir);
      scores.push(...ran.scores);
      logs.push(...ran.sessionLogs);
    }
    return { scores, logs };
  };

  for (let cycle = history.length ? Math.max(...history.map((entry) => entry.cycle)) + 1 : 1; cycle <= (history.length ? history[history.length - 1].cycle : 0) + cycles; cycle += 1) {
    console.log(`cycle ${cycle}: baseline on ${dev.length} dev tasks x ${repeat}`);
    const baseline = runAll(dev, 'baseline');
    const clusters = cluster(baseline.logs.map((file) => ({ id: path.basename(file, '.jsonl'), events: readTranscript(file), success: baseline.scores.find((run) => file.includes(`${run.task}-baseline-${run.repeat}`))?.success }))).slice(0, 3);
    if (!clusters.length) {
      console.log('no signals in the baseline runs; nothing to mutate');
      break;
    }
    const surfaces = [...new Set(clusters.map(route))].filter((surface) => surface !== 'none');
    console.log(`top clusters: ${clusters.map((entry) => `${entry.signature} (x${entry.count}, ${entry.failedSessions} failed)`).join('; ')}`);
    console.log(`surfaces: ${surfaces.join(', ') || 'none the search may change'}`);
    if (!surfaces.length) break;
    const candidates = (await propose({ clusters, surfaces, history, baseline: {} })).slice(0, MAX_CANDIDATES);
    const scored: { candidate: Candidate; dev: Lift }[] = [];
    for (const candidate of candidates) {
      const problem = lint(candidate, dev);
      if (problem) {
        console.log(`skipped ${candidate.name}: ${problem}`);
        continue;
      }
      console.log(`running ${candidate.name} on ${candidate.surface}`);
      const run = runAll(dev, candidate.name, candidate.harness);
      const devLift = lift(baseline.scores, run.scores);
      scored.push({ candidate, dev: devLift });
      console.log(`  success ${devLift.success.baseline.toFixed(2)} -> ${devLift.success.candidate.toFixed(2)} (CI ${devLift.success.ciLower.toFixed(2)}..${devLift.success.ciUpper.toFixed(2)}), tokens ${(devLift.tokensPerCompleted.relLift * 100).toFixed(0)}%, cached ${(devLift.cachedShare.delta * 100).toFixed(0)} pts`);
    }
    const best = scored.sort((a, b) => b.dev.success.relLift - a.dev.success.relLift || a.dev.tokensPerCompleted.relLift - b.dev.tokensPerCompleted.relLift)[0];
    if (!best) break;
    const verdict = worthHolding(best.dev);
    let entry: HistoryEntry = { cycle, candidate: best.candidate, dev: best.dev, accepted: false, reason: verdict.reason };
    if (verdict.ok && held.length) {
      console.log(`held-out check of ${best.candidate.name} on ${held.length} tasks`);
      const heldBaseline = runAll(held, 'baseline-held');
      const heldRun = runAll(held, `${best.candidate.name}-held`, best.candidate.harness);
      const heldLift = lift(heldBaseline.scores, heldRun.scores);
      const confirms = heldLift.success.relLift >= 0 && heldLift.tokensPerCompleted.relLift <= 0.1;
      entry = { ...entry, held: heldLift, accepted: confirms, reason: confirms ? `${verdict.reason}; the held-out split agrees` : `${verdict.reason}; the held-out split disagrees (overfit)` };
    } else if (verdict.ok) {
      entry = { ...entry, accepted: true, reason: `${verdict.reason}; no held-out split to confirm it` };
    }
    history.push(entry);
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
    console.log(`${entry.accepted ? 'ACCEPTED' : 'rejected'} ${best.candidate.name}: ${entry.reason}`);
    if (entry.accepted) console.log(`land it as a commit citing ${outDir}:\n${JSON.stringify(best.candidate.harness, null, 2)}`);
  }
}

if (import.meta.main) await main();
