import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { canDelegate, childTurns, delegationTranscriptLine } from '../delegation/bounds.js';
import type { DelegationOutcome, DelegationRequest } from '../delegation/types.js';
import type { CategoryChain } from '../../types/config.js';
import { describeChain } from '../routing/categories.js';
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

const background = new Map<string, BackgroundTask>();

const running = () => [...background.values()].filter((task) => task.status === 'running').length;

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
  const decision = canDelegate({ depth: ctx.delegationDepth ?? 0, running: running(), config });
  if (!decision.allowed) return { output: `Delegation refused: ${decision.reason}`, status: 'error' };

  const agent = typeof args.agent === 'string' && args.agent.trim() ? args.agent.trim() : undefined;
  const reasoning = args.reasoning === 'off' || args.reasoning === 'on' || args.reasoning === 'auto' ? args.reasoning : undefined;
  const prompt = String(args.prompt ?? '');
  const maxTurns = childTurns(config, typeof args.max_turns === 'number' ? args.max_turns : undefined);
  const isolation = args.isolation === 'worktree' ? ({ isolation: 'worktree' } as const) : {};

  if (args.background) {
    const task = startBackground(ctx, { ...(agent ? { agent } : {}), ...(reasoning ? { reasoning } : {}), prompt, maxTurns, ...isolation });
    return {
      output: [
        `Started background task ${task.id} on ${agent ? `agent "${agent}"` : 'the default agent'} (max ${maxTurns} turns).`,
        `Poll it with task_status {"id":"${task.id}"} and collect it with task_result.`,
      ].join('\n'),
      metadata: { id: task.id, ...(agent ? { agent } : {}) },
    };
  }

  const outcome = await ctx.delegate({
    ...(agent ? { agent } : {}),
    ...(reasoning ? { reasoning } : {}),
    prompt,
    maxTurns,
    ...isolation,
    background: false,
    signal: ctx.signal,
    onText: ctx.onProgress,
    requestApproval: ctx.requestApproval,
  });
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
  const task: BackgroundTask = {
    id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    agent: options.agent ?? '',
    prompt: options.prompt,
    ...(options.isolation ? { isolation: options.isolation } : {}),
    status: 'running',
    output: '',
    startedAt: Date.now(),
    controller: new AbortController(),
  };
  background.set(task.id, task);
  ctx
    .delegate!({
      ...options,
      background: true,
      signal: task.controller.signal,
      onText: (delta) => {
        task.output += delta;
      },
    })
    .then((outcome) => {
      if (task.status === 'running') task.status = outcome.status;
      task.agent = outcome.agent;
      task.output = outcome.response || task.output;
      task.resolvedModel = outcome.resolvedModel;
      task.childSessionId = outcome.childSessionId;
      task.reason = outcome.reason;
      task.worktree = outcome.worktree?.summary;
    })
    .catch((error: any) => {
      task.status = 'error';
      task.reason = error?.message ?? String(error);
    });
  return task;
}

export async function taskStatusRunner(args: Record<string, any>): Promise<ToolRunPayload> {
  const task = background.get(String(args.id ?? ''));
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

export async function taskResultRunner(args: Record<string, any>): Promise<ToolRunPayload> {
  const task = background.get(String(args.id ?? ''));
  if (!task) return { output: `No background task ${String(args.id ?? '')}.`, status: 'error' };
  if (task.status === 'running') {
    return { output: `Task ${task.id} is still running. Poll task_status.` };
  }
  background.delete(task.id);
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
export async function taskCancelRunner(args: Record<string, any>): Promise<ToolRunPayload> {
  const task = background.get(String(args.id ?? ''));
  if (!task) return { output: `No background task ${String(args.id ?? '')}.`, status: 'error' };
  task.controller.abort();
  task.status = 'cancelled';
  return { output: `Cancelled ${task.id}.${task.output ? ` Partial output:\n${task.output}` : ''}` };
}

/** One agent as the model is shown it. */
export interface OfferedAgent {
  name: string;
  description?: string;
  chain: CategoryChain;
}

const GUIDANCE = `Delegate when:
- The work is independent and its intermediate output is not worth keeping in your context: a survey, a search across many files, a check that can run while you continue.
- There are several independent pieces: call task once per piece in the same step so they run together.

Do it yourself when:
- You are reading one known file, or searching two or three. That is faster than briefing a child.
- The work depends on this conversation in ways you cannot restate in the prompt.

Writing the prompt: the child starts with nothing. Brief it like a capable colleague who just walked in. Say what you are trying to achieve and why, what you already know or have ruled out, the exact files and lines involved, and what form the answer should take. Say whether it should change code or only report. Never delegate understanding: "based on your findings, fix it" hands the child the synthesis you owe.

background: true starts the child and returns an id at once. Collect it with task_result. Use it only when you have other work to do meanwhile.`;

/**
 * The `task` description the model chooses from: one line per agent, its description and
 * the chain it runs on, the default, and when and how to delegate. The chain is generated,
 * so a description that oversells a model sits beside the model that will do the work.
 */
export function taskDescription(agents: OfferedAgent[], defaultAgent?: string): string {
  const intro =
    'Delegate a self-contained piece of work to a child agent. It runs on its own model and session with the same tools as you, under your permissions, and returns one final message. The person does not see that message, so tell them what matters in it.';
  if (!agents.length) return `${intro}\n\nNo agent can run: none has a model on a configured provider.`;
  const lines = agents.map((agent) => `- ${agent.name}: ${agent.description ? `${agent.description} ` : ''}(runs on ${describeChain(agent.chain)})`);
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
