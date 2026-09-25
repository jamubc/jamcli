import { createRuntime, type Runtime, type RuntimeOptions } from '../runtime/index.js';
import { loadConfig } from '../config/load.js';
import { categoriesOf } from '../runtime/children.js';
import { resolveRoute } from '../routing/resolve.js';
import { commitChanges } from '../git/commit.js';
import type { AgentEvent, RunResult } from '../types.js';
import { executeWorkflow, type StepOutcome, type StepRunners } from './engine.js';
import { findWorkflow, resolveInputs } from './schema.js';

export interface RuntimeRunnerOptions {
  projectRoot: string;
  /** Extra runtime options for every step's session: `allowTools` from `--allow-tool`, the environment. */
  runtime?: Partial<RuntimeOptions>;
  /**
   * Ask the person: an approval step, or a call a step wants to make. Absent when nobody can
   * answer, as headless: approval steps wait, and calls that ask are denied.
   */
  ask?: (question: string) => Promise<boolean>;
  onEvent?: (step: string, event: AgentEvent) => void;
  /** How deep a nested workflow may go. */
  depth?: number;
}

const MAX_DEPTH = 5;

/**
 * Steps carried out by runtimes: each agent, run, and tool step opens its own session on
 * the `workflow` surface, so permissions, the sandbox, hooks, checkpoints, and the session
 * log apply as they do anywhere else.
 */
export function runtimeRunners(options: RuntimeRunnerOptions): StepRunners {
  const depth = options.depth ?? 0;
  const open = (extra: Partial<RuntimeOptions> = {}) => createRuntime({ projectRoot: options.projectRoot, surface: 'workflow', ...options.runtime, ...extra });
  const handler = (label: string) => (event: AgentEvent) => {
    if (event.type === 'approval_request') {
      const reason = event.request?.reason ?? 'this tool asks before it runs';
      if (options.ask) void options.ask(`Step ${label} asks to run ${event.call.name}: ${reason}. Allow it?`).then((allow) => event.decide({ allow }));
      else event.decide({ allow: false, by: 'mode', feedback: `a workflow run with nobody to ask cannot approve it, and ${reason}. Pass --allow-tool ${event.call.name} to allow it.` });
    }
    options.onEvent?.(label, event);
  };
  const outcome = (result: RunResult): StepOutcome => ({
    ok: result.status === 'ok',
    cancelled: result.status === 'cancelled',
    output: result.response || result.error || result.status,
  });
  const within = async (runtime: Runtime, signal: AbortSignal, work: () => Promise<RunResult>) => {
    const stop = () => runtime.cancel();
    signal.addEventListener('abort', stop, { once: true });
    try {
      return outcome(await work());
    } finally {
      signal.removeEventListener('abort', stop);
      await runtime.close();
    }
  };
  return {
    async agent(step, prompt, signal) {
      const spec = step.agent!;
      let model = spec.model;
      if (!model && spec.category) {
        const config = loadConfig({ projectRoot: options.projectRoot }).config;
        const route = await resolveRoute({ registry: config.api_registry, categories: categoriesOf(config), category: spec.category });
        if (!route) return { ok: false, output: `There is no category ${spec.category}.` };
        if (!route.model) return { ok: false, output: route.notes.join(' ') };
        model = route.model;
      }
      const runtime = await open({ ...(model ? { model } : {}), ...(spec.mode ? { permissions: { ...options.runtime?.permissions, mode: spec.mode } } : {}) });
      return within(runtime, signal, () => runtime.run(prompt, handler(step.id), { label: `step ${step.id}`, ...(spec.allowed_tools ? { allowedTools: spec.allowed_tools } : {}) }));
    },
    async run(command, signal) {
      const runtime = await open();
      return within(runtime, signal, () => runtime.run(command, handler('run'), { shell: true }));
    },
    async tool(name, args, signal) {
      const runtime = await open();
      return within(runtime, signal, () => runtime.run(name, handler(name), { tool: { name, arguments: args } }));
    },
    async approval(message) {
      if (!options.ask) return 'wait';
      return (await options.ask(message)) ? 'approved' : 'rejected';
    },
    async commit(message, paths, signal) {
      let text = message;
      if (message.trim() === 'agent') {
        const runtime = await open();
        try {
          text = await runtime.draftCommitMessage(paths ?? [], signal);
        } catch (error: any) {
          return { ok: false, output: `The message could not be drafted: ${error?.message ?? error}` };
        } finally {
          await runtime.close();
        }
      }
      try {
        const attribution = loadConfig({ projectRoot: options.projectRoot }).config.git?.attribution;
        const committed = await commitChanges(options.projectRoot, text, { ...(paths?.length ? { paths } : {}), ...(attribution ? { attribution } : {}) });
        return { ok: true, output: `${committed.sha.slice(0, 12)} ${committed.subject}` };
      } catch (error: any) {
        return { ok: false, output: error?.message ?? String(error) };
      }
    },
    async workflow(name, given, signal) {
      if (depth >= MAX_DEPTH) return { ok: false, output: `Workflows nest at most ${MAX_DEPTH} deep.` };
      const nested = findWorkflow(options.projectRoot, name);
      const summary = await executeWorkflow(nested, {
        projectRoot: options.projectRoot,
        inputs: resolveInputs(nested, given),
        runners: runtimeRunners({ ...options, depth: depth + 1 }),
        signal,
      });
      const last = [...nested.steps].reverse().find((step) => summary.steps[step.id].status === 'ok');
      return { ok: summary.status === 'ok', cancelled: summary.status === 'cancelled', output: `run ${summary.runId} ${summary.status}${last ? `: ${summary.steps[last.id].output}` : ''}` };
    },
  };
}
