import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import type { WorkTable } from '../work.js';
import { canDelegate, childTurns, delegationTranscriptLine } from '../delegation/bounds.js';
import type { DelegationOutcome, DelegationRequest } from '../delegation/types.js';
import type { CategoryChain } from '../../types/config.js';
import { describeChain } from '../routing/categories.js';
import { EFFORT_LEVELS, isEffortLevel, type EffortLevel } from '../routing/capabilities.js';
import { DEFAULT_DELEGATION_CONFIG } from '../../types/config.js';

interface BackgroundTask {
  id: string;
  /** The agent asked for, then the one that ran; empty until the default resolves. */
  agent: string;
  prompt: string;
  status: 'running' | DelegationOutcome['status'];
  /** The child's reply so far, then its final response. */
  output: string;
  resolvedModel?: string;
  childSessionId?: string;
  reason?: string;
  /** Where an isolated task's changes are. */
  worktree?: string;
  isolation?: 'worktree';
  startedAt: number;
  controller: AbortController;
}

const taskId = () => `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** A child as the person sees it listed: its agent and the start of its task. */
const labelFor = (agent: string | undefined, prompt: string) => `${agent ?? 'default agent'}: ${prompt.replace(/\s+/g, ' ').trim().slice(0, 60)}`;

const taskOf = (ctx: ToolContext, id: unknown): BackgroundTask | undefined => ctx.work?.get<BackgroundTask>(String(id ?? ''))?.record;

/**
 * What a child reports to the work table as it runs: the agent and model it resolved to,
 * its session, and each of its events, so the person can see what it is doing and look in,
 * and what the person says to it, which it reads with its next step. Its prompts name the
 * agent that asks, so two children asking at once can be told apart.
 */
const watched = (work: WorkTable, id: string, prompt: string, ask: ToolContext['requestApproval']): Pick<DelegationRequest, 'onStart' | 'onEvent' | 'heard' | 'requestApproval'> => {
  let agent = 'a child agent';
  return {
    onStart: (child) => {
      agent = `agent ${child.agent}`;
      work.update(id, { ...child, label: labelFor(child.agent, prompt) });
    },
    onEvent: (event) => work.record(id, event),
    heard: () => work.drainSaid(id),
    ...(ask ? { requestApproval: ({ call, request }) => ask({ call, request: request && { ...request, reason: `${agent} (${id}) asks, and ${request.reason}` } }) } : {}),
  };
};

const taskSchema: JsonSchema = {
  type: 'object',
  properties: {
    agent: { type: 'string', description: 'The agent to run the child on, from the list above. Omit it to use the default.' },
    prompt: { type: 'string', description: 'The task for the child agent.' },
    reasoning: {
      type: 'string',
      enum: ['off', 'on', 'auto'],
      description: "on for work that needs careful multi-step thought, off for lookups. Omit it to use the agent's own setting.",
    },
    effort: {
      type: 'string',
      enum: [...EFFORT_LEVELS],
      description: "How hard the child thinks: low for lookups, high or above for hard problems. Omit for the agent's own.",
    },
    background: { type: 'boolean', description: 'Start the child and return immediately with its id.' },
    max_turns: { type: 'integer', minimum: 1, description: 'Optional bound on child turns.' },
    isolation: {
      type: 'string',
      enum: ['none', 'worktree'],
      description: 'worktree: the child works in a git worktree of its own on a jamcli/ branch, and its changes are reported with that location.',
    },
  },
  required: ['prompt'],
  additionalProperties: false,
};

const idSchema: JsonSchema = {
  type: 'object',
  properties: { id: { type: 'string', description: 'Identifier returned by task.' } },
  required: ['id'],
  additionalProperties: false,
};

const statusOf = (outcome: DelegationOutcome): ToolRunPayload['status'] =>
  outcome.status === 'ok' ? 'ok' : outcome.status === 'cancelled' ? 'cancelled' : 'error';

const lineFor = (outcome: DelegationOutcome) =>
  delegationTranscriptLine({
    agent: outcome.agent,
    resolvedModel: outcome.resolvedModel ?? 'unresolved',
    childSessionId: outcome.childSessionId ?? 'none',
    status: outcome.status,
  });

/**
 * Delegate to a child run. The runtime supplies `ctx.delegate`, which runs the child in
 * this process on its agent's model and rules, under this session's policy.
 */
export async function taskRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  if (!ctx.delegate) return { output: 'Delegation is not available in this session.', status: 'error' };
  const config = ctx.delegationConfig ?? DEFAULT_DELEGATION_CONFIG;
  const decision = canDelegate({ depth: ctx.delegationDepth ?? 0, running: ctx.work?.running('task') ?? 0, config });
  if (!decision.allowed) return { output: `Delegation refused: ${decision.reason}`, status: 'error' };

  const agent = typeof args.agent === 'string' && args.agent.trim() ? args.agent.trim() : undefined;
  const reasoning = args.reasoning === 'off' || args.reasoning === 'on' || args.reasoning === 'auto' ? args.reasoning : undefined;
  const effort = isEffortLevel(args.effort) ? args.effort : undefined;
  const prompt = String(args.prompt ?? '');
  const maxTurns = childTurns(config, typeof args.max_turns === 'number' ? args.max_turns : undefined);
  const isolation = args.isolation === 'worktree' ? ({ isolation: 'worktree' } as const) : {};

  if (args.background) {
    const task = startBackground(ctx, { ...(agent ? { agent } : {}), ...(reasoning ? { reasoning } : {}), ...(effort ? { effort } : {}), prompt, maxTurns, ...isolation });
    return {
      output: [
        `Started background task ${task.id} on ${agent ? `agent "${agent}"` : 'the default agent'} (max ${maxTurns} turns).`,
        `Poll it with task_status {"id":"${task.id}"} and collect it with task_result.`,
      ].join('\n'),
      metadata: { id: task.id, ...(agent ? { agent } : {}) },
    };
  }

  // A foreground child is listed while it runs, so the person can see it and stop it; its result comes back here, so there is no news to tell.
  const controller = new AbortController();
  ctx.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  const entry = ctx.work?.add({ id: taskId(), kind: 'task', label: labelFor(agent, prompt), record: undefined, told: true, stop: () => controller.abort(), ...(agent ? { agent } : {}) });
  let outcome: DelegationOutcome;
  try {
    outcome = await ctx.delegate({
      ...(agent ? { agent } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(effort ? { effort } : {}),
      prompt,
      maxTurns,
      ...isolation,
      background: false,
      signal: controller.signal,
      onText: ctx.onProgress,
      requestApproval: ctx.requestApproval,
      ...(entry ? watched(ctx.work!, entry.id, prompt, ctx.requestApproval) : {}),
      onResult: ctx.onNestedResult,
    });
  } catch (error) {
    if (entry) ctx.work!.end(entry.id, 'error');
    throw error;
  }
  if (entry) ctx.work!.end(entry.id, outcome.status);
  if (outcome.status === 'refused' && !outcome.childSessionId) {
    return { output: `Delegation refused: ${outcome.reason ?? 'no model in the chain can serve it'}`, status: 'error' };
  }
  return {
    output: [lineFor(outcome), '', outcome.response || outcome.reason || '(no output)', ...(outcome.worktree ? ['', outcome.worktree.summary] : [])].join('\n'),
    status: statusOf(outcome),
    metadata: {
      agent: outcome.agent,
      resolvedModel: outcome.resolvedModel,
      childSessionId: outcome.childSessionId,
      ...(outcome.worktree ? { worktree: outcome.worktree.path, branch: outcome.worktree.branch } : {}),
    },
  };
}

function startBackground(ctx: ToolContext, options: Omit<DelegationRequest, 'background'>): BackgroundTask {
  if (!ctx.work) throw new Error('Background tasks are not available in this session.');
  const work = ctx.work;
  const task: BackgroundTask = {
    id: taskId(),
    agent: options.agent ?? '',
    prompt: options.prompt,
    ...(options.isolation ? { isolation: options.isolation } : {}),
    status: 'running',
    output: '',
    startedAt: Date.now(),
    controller: new AbortController(),
  };
  work.add<BackgroundTask>({
    id: task.id,
    kind: 'task',
    label: labelFor(options.agent, options.prompt),
    record: task,
    stop: () => {
      task.controller.abort();
      task.status = 'cancelled';
    },
    ...(options.agent ? { agent: options.agent } : {}),
  });
  ctx
    .delegate!({
      ...options,
      background: true,
      signal: task.controller.signal,
      onText: (delta) => {
        task.output += delta;
      },
      ...watched(work, task.id, options.prompt, ctx.requestApproval),
      onResult: ctx.onNestedResult,
    })
    .then((outcome) => {
      if (task.status === 'running') task.status = outcome.status;
      task.agent = outcome.agent;
      task.output = outcome.response || task.output;
      task.resolvedModel = outcome.resolvedModel;
      task.childSessionId = outcome.childSessionId;
      task.reason = outcome.reason;
      task.worktree = outcome.worktree?.summary;
      work.end(task.id, task.status);
    })
    .catch((error: any) => {
      task.status = 'error';
      task.reason = error?.message ?? String(error);
      work.end(task.id, 'error');
    });
  return task;
}

export async function taskStatusRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const task = taskOf(ctx, args.id);
  if (!task) return { output: `No background task ${String(args.id ?? '')}.`, status: 'error' };
  return {
    output: [
      `${task.id}: ${task.status}`,
      `agent ${task.agent || 'default, not yet resolved'}`,
      `model ${task.resolvedModel ?? 'unresolved'}`,
      `started ${new Date(task.startedAt).toISOString()}`,
      task.reason ? `reason ${task.reason}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export async function taskResultRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const task = taskOf(ctx, args.id);
  if (!task) return { output: `No background task ${String(args.id ?? '')}.`, status: 'error' };
  if (task.status === 'running') {
    return { output: `Task ${task.id} is still running. You are told when it ends; task_status has its state meanwhile.` };
  }
  ctx.work!.forget(task.id);
  const line = delegationTranscriptLine({
    agent: task.agent,
    resolvedModel: task.resolvedModel ?? 'unresolved',
    childSessionId: task.childSessionId ?? 'none',
    status: task.status,
  });
  return {
    output: [line, '', task.output || task.reason || '(no output)', ...(task.worktree ? ['', task.worktree] : [])].join('\n'),
    metadata: { status: task.status, childSessionId: task.childSessionId },
  };
}

/** Stop a background task and report what it had written so far. */
export async function taskCancelRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const task = taskOf(ctx, args.id);
  if (!task) return { output: `No background task ${String(args.id ?? '')}.`, status: 'error' };
  ctx.work!.stop(task.id);
  return { output: `Cancelled ${task.id}.${task.output ? ` Partial output:\n${task.output}` : ''}` };
}

/** One agent as the model is shown it. */
export interface OfferedAgent {
  name: string;
  description?: string;
  chain: CategoryChain;
  /** Runs on the session's model rather than a chain. */
  inherits?: boolean;
  /** The effort an agent on the session's model runs at. */
  effort?: EffortLevel;
}

const GUIDANCE = `Delegate when:
- The work is independent and its intermediate output is not worth keeping in your context: a survey, a search across many files, a check that can run while you continue.
- There are several independent pieces: call task once per piece in the same step so they run together.

Do it yourself when:
- You are reading one known file, or searching two or three. That is faster than briefing a child.
- The work depends on this conversation in ways you cannot restate in the prompt.

Writing the prompt: the child starts with nothing. Brief it like a capable colleague who just walked in. Say what you are trying to achieve and why, what you already know or have ruled out, the exact files and lines involved, and what form the answer should take. Say whether it should change code or only report. Never delegate understanding: "based on your findings, fix it" hands the child the synthesis you owe.

background: true starts the child and returns an id at once, and you are told when it ends; collect it with task_result. Prefer it for a fan-out of two or more children, and whenever you have other work to do meanwhile: the person sees each child on the plan board as it runs, with what it is doing and what it has cost, and can look in on any of them. Children started in the same step run at the same time either way.`;

/**
 * The `task` description the model chooses from: one line per agent, its description and
 * the chain it runs on, the default, and when and how to delegate. The chain is generated,
 * so a description that oversells a model sits beside the model that will do the work.
 */
export function taskDescription(agents: OfferedAgent[], defaultAgent?: string): string {
  const intro =
    'Delegate a self-contained piece of work to a child agent. It runs on its own model and session with the same tools as you, under your permissions, and returns one final message. The person does not see that message, so tell them what matters in it.';
  if (!agents.length) return `${intro}\n\nNo agent can run: none has a model on a configured provider.`;
  const runsOn = (agent: OfferedAgent) => (agent.inherits ? `the same model as you${agent.effort ? `, effort ${agent.effort}` : ''}` : describeChain(agent.chain));
  const lines = agents.map((agent) => `- ${agent.name}: ${agent.description ? `${agent.description} ` : ''}(runs on ${runsOn(agent)})`);
  const offered = defaultAgent && agents.some((agent) => agent.name === defaultAgent);
  const rule = offered ? `If you omit agent, ${defaultAgent} is used.` : 'Always name an agent.';
  return [intro, ['Agents (choose by what the work needs):', ...lines, rule].join('\n'), GUIDANCE].join('\n\n');
}

export const TASK_TOOLS: RegisteredTool[] = [
  {
    name: 'task',
    description:
      'Delegate a self-contained piece of work to a child agent. Returns the child result, or an id when background is set.',
    inputSchema: taskSchema,
    policy: 'delegate',
    runner: taskRunner,
  },
  {
    name: 'task_status',
    description: 'Report the status of a background delegated task.',
    inputSchema: idSchema,
    policy: 'read',
    runner: taskStatusRunner,
  },
  {
    name: 'task_result',
    description: 'Collect the output of a finished background delegated task.',
    inputSchema: idSchema,
    policy: 'read',
    runner: taskResultRunner,
  },
  {
    name: 'task_cancel',
    description: 'Cancel a running background delegated task.',
    inputSchema: idSchema,
    policy: 'delegate',
    runner: taskCancelRunner,
  },
];
