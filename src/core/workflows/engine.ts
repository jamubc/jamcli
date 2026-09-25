import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { holds, render } from './expr.js';
import { stepKind, type Workflow, type WorkflowStep } from './schema.js';

export type StepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped' | 'waiting' | 'cancelled';
export type RunStatus = 'ok' | 'failed' | 'waiting' | 'cancelled';

export interface StepState {
  status: StepStatus;
  output: string;
}

export interface StepOutcome {
  ok: boolean;
  output: string;
  cancelled?: boolean;
}

/** How each kind of step is carried out. The engine only orders them and records what happened. */
export interface StepRunners {
  agent(step: WorkflowStep, prompt: string, signal: AbortSignal): Promise<StepOutcome>;
  run(command: string, signal: AbortSignal): Promise<StepOutcome>;
  tool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<StepOutcome>;
  /** `approved` or `rejected` from a person, or `wait` when nobody can answer now. */
  approval(message: string, step: string): Promise<'approved' | 'rejected' | 'wait'>;
  /** `message` of `agent` asks the model to draft one. */
  commit(message: string, paths: string[] | undefined, signal: AbortSignal): Promise<StepOutcome>;
  workflow(name: string, inputs: Record<string, string | number | boolean>, signal: AbortSignal): Promise<StepOutcome>;
}

export type RunLogEvent =
  | { type: 'start'; run: string; workflow: string; file: string; inputs: Record<string, string | number | boolean>; at: string }
  | { type: 'step'; id: string; status: StepStatus; output?: string; at: string }
  | { type: 'approval'; id: string; approved: boolean; at: string }
  | { type: 'end'; status: RunStatus; at: string };

export const runsDir = (projectRoot: string) => path.join(projectRoot, '.jamcli', 'workflows', 'runs');
export const runLogPath = (projectRoot: string, runId: string) => {
  if (!/^[\w-]+$/.test(runId)) throw new Error(`${runId} is not a run id.`);
  return path.join(runsDir(projectRoot), `${runId}.jsonl`);
};

const append = (file: string, event: RunLogEvent) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
};

export function readRunLog(projectRoot: string, runId: string): RunLogEvent[] {
  const file = runLogPath(projectRoot, runId);
  if (!fs.existsSync(file)) throw new Error(`There is no workflow run ${runId}.`);
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as RunLogEvent];
      } catch {
        return [];
      }
    });
}

/** Record a person's answer to a waiting approval step, for `resume` to act on. */
export function recordApproval(projectRoot: string, runId: string, step: string, approved: boolean): void {
  const events = readRunLog(projectRoot, runId);
  const last = [...events].reverse().find((event) => event.type === 'step' && event.id === step);
  if (!last || last.type !== 'step' || last.status !== 'waiting') throw new Error(`Step ${step} of run ${runId} is not waiting for approval.`);
  append(runLogPath(projectRoot, runId), { type: 'approval', id: step, approved, at: new Date().toISOString() });
}

export interface RunSummary {
  runId: string;
  workflow: string;
  status: RunStatus | 'running';
  steps: Record<string, StepState>;
  started: string;
}

/** What a run's log says: the last state of each step and the run. */
export function summarizeRun(projectRoot: string, runId: string): RunSummary {
  const events = readRunLog(projectRoot, runId);
  const start = events.find((event) => event.type === 'start');
  if (!start || start.type !== 'start') throw new Error(`The log of run ${runId} has no start.`);
  const steps: Record<string, StepState> = {};
  let status: RunSummary['status'] = 'running';
  for (const event of events) {
    if (event.type === 'step') steps[event.id] = { status: event.status, output: event.output ?? steps[event.id]?.output ?? '' };
    if (event.type === 'end') status = event.status;
    if (event.type === 'start') status = 'running';
  }
  return { runId, workflow: start.workflow, status, steps, started: start.at };
}

export function listRuns(projectRoot: string): RunSummary[] {
  const dir = runsDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith('.jsonl'))
    .flatMap((entry) => {
      try {
        return [summarizeRun(projectRoot, entry.slice(0, -'.jsonl'.length))];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.started.localeCompare(a.started));
}

export interface ExecuteOptions {
  projectRoot: string;
  runners: StepRunners;
  inputs: Record<string, string | number | boolean>;
  signal?: AbortSignal;
  /** Continue this run from its log instead of starting one. */
  resume?: string;
  /** Told of each step as its state changes. */
  onStep?: (id: string, state: StepState) => void;
}

const TERMINAL: StepStatus[] = ['ok', 'failed', 'skipped', 'cancelled'];

/**
 * Run a workflow: steps whose needs have finished start, up to its concurrency; a step whose
 * need failed fails too unless it sets `continue_on_error`; a false condition skips it; an
 * approval nobody can answer waits, and the run ends `waiting` for `resume`. Every change
 * is appended to the run log first, so a run stopped at any point resumes at the first
 * step that had not finished.
 */
export async function executeWorkflow(workflow: Workflow, options: ExecuteOptions): Promise<RunSummary> {
  const signal = options.signal ?? new AbortController().signal;
  const runId = options.resume ?? `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const file = runLogPath(options.projectRoot, runId);
  const steps: Record<string, StepState> = Object.fromEntries(workflow.steps.map((step) => [step.id, { status: 'pending' as StepStatus, output: '' }]));
  let inputs = options.inputs;
  if (options.resume) {
    const events = readRunLog(options.projectRoot, runId);
    for (const event of events) {
      if (event.type === 'start') inputs = event.inputs;
      if (event.type === 'step' && steps[event.id]) steps[event.id] = { status: event.status, output: event.output ?? '' };
      if (event.type === 'approval' && steps[event.id]?.status === 'waiting') {
        steps[event.id] = { status: event.approved ? 'ok' : 'failed', output: event.approved ? 'approved' : 'rejected' };
        append(file, { type: 'step', id: event.id, status: steps[event.id].status, output: steps[event.id].output, at: new Date().toISOString() });
      }
    }
    // A step cut off while running starts again; a cancelled one gets another chance.
    for (const state of Object.values(steps)) if (state.status === 'running' || state.status === 'cancelled') ((state.status = 'pending'), (state.output = ''));
  } else {
    append(file, { type: 'start', run: runId, workflow: workflow.name, file: workflow.file, inputs, at: new Date().toISOString() });
  }

  const set = (id: string, status: StepStatus, output = steps[id].output) => {
    steps[id] = { status, output };
    append(file, { type: 'step', id, status, output, at: new Date().toISOString() });
    options.onStep?.(id, steps[id]);
  };
  const context = () => ({ inputs, steps });
  const running = new Map<string, Promise<void>>();

  const start = (step: WorkflowStep) => {
    const needs = step.needs ?? [];
    const broken = needs.filter((need) => ['failed', 'cancelled'].includes(steps[need].status));
    if (broken.length && !step.continue_on_error) return set(step.id, 'failed', `It needs ${broken.join(', ')}, which did not succeed.`);
    try {
      if (step.when && !holds(step.when, context())) return set(step.id, 'skipped', `Skipped: ${step.when} is false.`);
    } catch (error: any) {
      return set(step.id, 'failed', `Its condition could not be evaluated: ${error?.message ?? error}`);
    }
    set(step.id, 'running', '');
    const work = (async (): Promise<[StepStatus, string]> => {
      const text = (value: string) => render(value, context());
      switch (stepKind(step)) {
        case 'agent': {
          const outcome = await options.runners.agent(step, text(step.agent!.prompt), signal);
          return [outcome.cancelled ? 'cancelled' : outcome.ok ? 'ok' : 'failed', outcome.output];
        }
        case 'run': {
          const outcome = await options.runners.run(text(step.run!), signal);
          return [outcome.cancelled ? 'cancelled' : outcome.ok ? 'ok' : 'failed', outcome.output];
        }
        case 'tool': {
          const args = Object.fromEntries(Object.entries(step.tool!.arguments).map(([key, value]) => [key, typeof value === 'string' ? text(value) : value]));
          const outcome = await options.runners.tool(step.tool!.name, args, signal);
          return [outcome.cancelled ? 'cancelled' : outcome.ok ? 'ok' : 'failed', outcome.output];
        }
        case 'approval': {
          const answer = await options.runners.approval(text(step.approval!.message), step.id);
          return answer === 'wait' ? ['waiting', text(step.approval!.message)] : [answer === 'approved' ? 'ok' : 'failed', answer];
        }
        case 'commit': {
          const outcome = await options.runners.commit(text(step.commit!.message), step.commit!.paths, signal);
          return [outcome.cancelled ? 'cancelled' : outcome.ok ? 'ok' : 'failed', outcome.output];
        }
        case 'workflow': {
          const given = Object.fromEntries(Object.entries(step.workflow!.inputs ?? {}).map(([key, value]) => [key, typeof value === 'string' ? text(value) : value]));
          const outcome = await options.runners.workflow(step.workflow!.name, given, signal);
          return [outcome.cancelled ? 'cancelled' : outcome.ok ? 'ok' : 'failed', outcome.output];
        }
      }
    })()
      .catch((error: any): [StepStatus, string] => [signal.aborted ? 'cancelled' : 'failed', error?.message ?? String(error)])
      .then(([status, output]) => {
        set(step.id, signal.aborted && status !== 'ok' ? 'cancelled' : status, output);
      })
      .finally(() => running.delete(step.id));
    running.set(step.id, work);
  };

  for (;;) {
    if (!signal.aborted) {
      for (const step of workflow.steps) {
        if (running.size >= workflow.concurrency) break;
        if (steps[step.id].status !== 'pending') continue;
        if (!(step.needs ?? []).every((need) => TERMINAL.includes(steps[need].status))) continue;
        start(step);
      }
    }
    if (!running.size) break;
    await Promise.race(running.values());
  }

  if (signal.aborted) for (const step of workflow.steps) if (steps[step.id].status === 'pending') set(step.id, 'cancelled', 'The run was stopped.');
  const all = Object.values(steps);
  const status: RunStatus = all.some((state) => state.status === 'cancelled')
    ? 'cancelled'
    : all.some((state) => state.status === 'waiting' || state.status === 'pending')
      ? 'waiting'
      : workflow.steps.some((step) => steps[step.id].status === 'failed' && !step.continue_on_error)
        ? 'failed'
        : 'ok';
  append(file, { type: 'end', status, at: new Date().toISOString() });
  return { runId, workflow: workflow.name, status, steps, started: new Date().toISOString() };
}
