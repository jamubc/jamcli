import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { canDelegate, childTurns, delegationTranscriptLine } from '../delegation/bounds.js';
import type { DelegationOutcome } from '../delegation/types.js';
import { DEFAULT_DELEGATION_CONFIG } from '../../types/config.js';

interface BackgroundTask {
  id: string;
  category: string;
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
    category: { type: 'string', description: 'Category naming the model chain to run the child on.' },
    prompt: { type: 'string', description: 'The task for the child agent.' },
    background: { type: 'boolean', description: 'Start the child and return immediately with its id.' },
    max_turns: { type: 'integer', minimum: 1, description: 'Optional bound on child turns.' },
    isolation: {
      type: 'string',
      enum: ['none', 'worktree'],
      description: 'worktree: the child works in a git worktree of its own on a jamcli/ branch, and its changes are reported with that location.',
    },
  },
  required: ['category', 'prompt'],
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
    category: outcome.category,
    resolvedModel: outcome.resolvedModel ?? 'unresolved',
    childSessionId: outcome.childSessionId ?? 'none',
    status: outcome.status,
  });

/**
 * Delegate to a child run. The runtime supplies `ctx.delegate`, which runs the child in
 * this process on a model from the category, under this session's policy.
 */
export async function taskRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  if (!ctx.delegate) return { output: 'Delegation is not available in this session.', status: 'error' };
  const config = ctx.delegationConfig ?? DEFAULT_DELEGATION_CONFIG;
  const decision = canDelegate({ depth: ctx.delegationDepth ?? 0, running: running(), config });
  if (!decision.allowed) return { output: `Delegation refused: ${decision.reason}`, status: 'error' };

  const category = String(args.category ?? '');
  const prompt = String(args.prompt ?? '');
  const maxTurns = childTurns(config, typeof args.max_turns === 'number' ? args.max_turns : undefined);
  const isolation = args.isolation === 'worktree' ? ({ isolation: 'worktree' } as const) : {};

  if (args.background) {
    const task = startBackground(ctx, { category, prompt, maxTurns, ...isolation });
    return {
      output: [
        `Started background task ${task.id} on category "${category}" (max ${maxTurns} turns).`,
        `Poll it with task_status {"id":"${task.id}"} and collect it with task_result.`,
      ].join('\n'),
      metadata: { id: task.id, category },
    };
  }

  const outcome = await ctx.delegate({
    category,
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
      category,
      resolvedModel: outcome.resolvedModel,
      childSessionId: outcome.childSessionId,
      ...(outcome.worktree ? { worktree: outcome.worktree.path, branch: outcome.worktree.branch } : {}),
    },
  };
}

function startBackground(ctx: ToolContext, options: { category: string; prompt: string; maxTurns: number; isolation?: 'worktree' }): BackgroundTask {
  const task: BackgroundTask = {
    id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    ...options,
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
      `category ${task.category}`,
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
    category: task.category,
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

export const TASK_TOOLS: RegisteredTool[] = [
  {
    name: 'task',
    description:
      'Delegate work to a child agent run on a model chosen by category. Returns the child result, or an id when background is set.',
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
