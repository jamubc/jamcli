import readline from 'readline';
import path from 'path';
import { executeWorkflow, listRuns, readRunLog, recordApproval, type RunSummary } from '../core/workflows/engine.js';
import { findWorkflow, loadWorkflows, resolveInputs, stepKind } from '../core/workflows/schema.js';
import { runtimeRunners } from '../core/workflows/runners.js';
import { installGitHook, listSchedules, removeGitHook, scheduleWorkflow, unscheduleWorkflow, type ScheduleSystem } from '../core/workflows/triggers.js';
import type { RuntimeOptions } from '../core/runtime/index.js';

export interface WorkflowIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Ask a yes-or-no question; absent when nobody can answer. */
  ask?: (question: string) => Promise<boolean>;
}

export const WORKFLOW_USAGE = [
  'Usage:',
  '  jamcli workflow list',
  '  jamcli workflow run <name> [--input name=value]... [--allow-tool <tool>]... [--headless]',
  '  jamcli workflow resume <run-id>',
  '  jamcli workflow approve <run-id> <step> [--reject]',
  '  jamcli workflow hook install <git-hook> <name> | hook remove <git-hook>',
  '  jamcli workflow schedule <name> --cron "<m h dom mon dow>" | unschedule <name> | schedules',
].join('\n');

const terminalAsk = (question: string) =>
  new Promise<boolean>((resolve) => {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stderr });
    prompt.question(`${question} [y/N] `, (answer) => {
      prompt.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });

const stdio: WorkflowIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  ...(process.stdin.isTTY ? { ask: terminalAsk } : {}),
};

/** How JamCLI is started again by a hook or a schedule: an absolute path, since cron's PATH is short. */
const jamcliCommand = () => Bun.which('jamcli') ?? path.resolve(process.argv[1] ?? 'jamcli');

const reportEnd = (summary: RunSummary, io: WorkflowIo): number => {
  const waiting = Object.entries(summary.steps).filter(([, state]) => state.status === 'waiting');
  if (summary.status === 'waiting' && waiting.length) {
    for (const [id, state] of waiting) io.out(`Waiting for approval at ${id}: ${state.output}\n  Approve with: jamcli workflow approve ${summary.runId} ${id}`);
    return 0;
  }
  io.out(`Run ${summary.runId} of ${summary.workflow} ended: ${summary.status}.`);
  return summary.status === 'ok' ? 0 : 1;
};

export interface WorkflowCommandOptions {
  io?: WorkflowIo;
  /** Runtime options every step's session gets, for tests. */
  runtime?: Partial<RuntimeOptions>;
  schedules?: ScheduleSystem;
}

/** `jamcli workflow ...`. */
export async function runWorkflowCommand(args: string[], projectRoot: string, options: WorkflowCommandOptions = {}): Promise<number> {
  const io = options.io ?? stdio;
  const headless = args.includes('--headless');
  const flag = (name: string) => args.flatMap((word, index) => (word === name && args[index + 1] !== undefined ? [args[index + 1]] : []));
  const valued = new Set(['--input', '--allow-tool', '--cron']);
  const words = args.filter((word, index) => !word.startsWith('--') && !valued.has(args[index - 1]));
  const [action = 'list', first, second] = words;
  const ask = headless ? undefined : io.ask;
  const runners = () =>
    runtimeRunners({
      projectRoot,
      runtime: { ...options.runtime, ...(flag('--allow-tool').length ? { allowTools: [...(options.runtime?.allowTools ?? []), ...flag('--allow-tool')] } : {}) },
      ...(ask ? { ask } : {}),
    });
  const onStep = (id: string, state: { status: string; output: string }) => {
    if (state.status === 'running') io.out(`- ${id}: running`);
    else if (state.status !== 'pending') io.out(`- ${id}: ${state.status}${state.output && state.status !== 'waiting' ? `\n    ${state.output.split('\n').slice(0, 6).join('\n    ')}` : ''}`);
  };
  try {
    switch (action) {
      case 'list': {
        const { workflows, problems } = loadWorkflows(projectRoot);
        if (!workflows.length) io.out('No workflows. Add YAML or JSON files to .jamcli/workflows/.');
        for (const workflow of workflows) io.out(`${workflow.name}: ${workflow.description ?? workflow.steps.map((step) => `${step.id} (${stepKind(step)})`).join(', ')}`);
        for (const problem of problems) io.err(`Not loaded: ${problem}`);
        const runs = listRuns(projectRoot).slice(0, 10);
        if (runs.length) io.out(['', 'Recent runs:', ...runs.map((run) => `  ${run.runId} ${run.workflow} ${run.status}`)].join('\n'));
        return problems.length ? 1 : 0;
      }
      case 'run': {
        if (!first) break;
        const workflow = findWorkflow(projectRoot, first);
        const given = Object.fromEntries(
          flag('--input').map((pair) => {
            const at = pair.indexOf('=');
            if (at < 1) throw new Error(`--input takes name=value, not ${pair}.`);
            return [pair.slice(0, at), pair.slice(at + 1)];
          })
        );
        const controller = new AbortController();
        const stop = () => controller.abort();
        process.once('SIGINT', stop);
        try {
          const summary = await executeWorkflow(workflow, { projectRoot, inputs: resolveInputs(workflow, given), runners: runners(), signal: controller.signal, onStep });
          return reportEnd(summary, io);
        } finally {
          process.off('SIGINT', stop);
        }
      }
      case 'resume': {
        if (!first) break;
        const start = readRunLog(projectRoot, first).find((event) => event.type === 'start');
        if (!start || start.type !== 'start') throw new Error(`The log of run ${first} has no start.`);
        const workflow = findWorkflow(projectRoot, start.workflow);
        return reportEnd(await executeWorkflow(workflow, { projectRoot, inputs: start.inputs, runners: runners(), resume: first, onStep }), io);
      }
      case 'approve': {
        if (!first || !second) break;
        recordApproval(projectRoot, first, second, !args.includes('--reject'));
        io.out(`${args.includes('--reject') ? 'Rejected' : 'Approved'} ${second}. Resuming run ${first}.`);
        return runWorkflowCommand(['resume', first, ...(headless ? ['--headless'] : [])], projectRoot, options);
      }
      case 'hook': {
        if (first === 'install' && second && words[3]) {
          findWorkflow(projectRoot, words[3]);
          io.out(`Wrote ${installGitHook(projectRoot, second, words[3], jamcliCommand())}. It runs ${words[3]} headless.`);
          return 0;
        }
        if (first === 'remove' && second) {
          const removed = removeGitHook(projectRoot, second);
          io.out(removed ? `Removed ${removed}.` : `No ${second} hook written by JamCLI.`);
          return 0;
        }
        break;
      }
      case 'schedule': {
        const cron = flag('--cron')[0];
        if (!first || !cron) break;
        findWorkflow(projectRoot, first);
        io.out(`Scheduled ${first} (${cron}) in ${scheduleWorkflow(cron, projectRoot, first, jamcliCommand(), options.schedules)}. It runs headless, so approval steps wait for jamcli workflow approve.`);
        return 0;
      }
      case 'unschedule': {
        if (!first) break;
        io.out(unscheduleWorkflow(projectRoot, first, options.schedules) ? `Unscheduled ${first}.` : `${first} was not scheduled.`);
        return 0;
      }
      case 'schedules': {
        const found = listSchedules(projectRoot, options.schedules);
        io.out(found.length ? found.join('\n') : 'No workflows are scheduled for this project.');
        return 0;
      }
    }
  } catch (error: any) {
    io.err(error?.message ?? String(error));
    return 1;
  }
  io.err(WORKFLOW_USAGE);
  return 2;
}
