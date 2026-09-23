import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { canDelegate, childTurns, delegationTranscriptLine } from '../delegation/bounds.js';
import { delegate } from '../delegation/route.js';
import type { DelegationConfig } from '../../types/config.js';
import { DEFAULT_DELEGATION_CONFIG } from '../../types/config.js';

interface BackgroundTask {
  id: string;
  category: string;
  prompt: string;
  status: 'running' | 'ok' | 'error' | 'cancelled' | 'refused';
  response?: string;
  resolvedModel?: string;
  childSessionId?: string;
  reason?: string;
  startedAt: number;
  controller: AbortController;
}

const background = new Map<string, BackgroundTask>();
const backgroundOutput = new Map<string, string[]>();

const DEPTH_KEY = 'jamcli.delegation.depth';

const depthOf = (ctx: ToolContext): number => {
  const value = (ctx as unknown as Record<string, unknown>)[DEPTH_KEY];
  return typeof value === 'number' ? value : 0;
};

const sameRoot = () => process.cwd();

const taskSchema: JsonSchema = {
  type: 'object',
  properties: {
    category: { type: 'string', description: 'Category naming the model chain to run the child on.' },
    prompt: { type: 'string', description: 'The task for the child agent.' },
    background: { type: 'boolean', description: 'Start the child and return immediately with its id.' },
    max_turns: { type: 'integer', minimum: 1, description: 'Optional bound on child turns.' },
  },
  required: ['category', 'prompt'],
  additionalProperties: false,
};

const statusSchema: JsonSchema = {
  type: 'object',
  properties: { id: { type: 'string', description: 'Identifier returned by task.' } },
  required: ['id'],
  additionalProperties: false,
};

const cancelSchema: JsonSchema = {
  type: 'object',
  properties: { id: { type: 'string', description: 'Identifier returned by task.' } },
  required: ['id'],
  additionalProperties: false,
};

export async function taskRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const runtime = runtimeFor(ctx);
  const decision = canDelegate({
    depth: depthOf(ctx),
    running: background.size,
    config: runtime.delegation ?? DEFAULT_DELEGATION_CONFIG,
  });
  if (!decision.allowed) {
    return { output: `Delegation refused: ${decision.reason}` };
  }

  const category = String(args.category ?? '');
  const prompt = String(args.prompt ?? '');
  const maxTurns = childTurns(runtime.delegation, typeof args.max_turns === 'number' ? args.max_turns : undefined);

  if (args.background) {
    const task = startBackground({ category, prompt, maxTurns, ctx });
    return {
      output: [
        `Started background task ${task.id} on category "${category}" (max ${maxTurns} turns).`,
        `Poll it with task_status {"id":"${task.id}"} and collect it with task_result.`,
      ].join('\n'),
      metadata: { id: task.id, category },
    };
  }

  const outcome = await delegate({
    command: runtime.command,
    args: [...runtime.args, '--max-turns', String(maxTurns)],
    category,
    prompt,
    cwd: ctx.projectRoot,
    registry: runtime.registry,
    categories: runtime.categories,
    config: runtime.delegation,
    depth: depthOf(ctx),
    running: 0,
    signal: ctx.signal,
  });

  if (outcome.status === 'refused') {
    return { output: `Delegation refused: ${outcome.reason ?? 'no servable entry in the chain'}` };
  }

  return {
    output: [
      outcome.transcriptLine ?? `Delegated "${category}"`,
      '',
      outcome.response || outcome.reason || '(no output)',
    ].join('\n'),
    metadata: {
      category: outcome.category,
      resolvedModel: outcome.resolvedModel,
      childSessionId: outcome.childSessionId,
    },
  };
}

export async function taskStatusRunner(args: Record<string, any>): Promise<ToolRunPayload> {
  const task = background.get(String(args.id ?? ''));
  if (!task) return { output: `No background task ${String(args.id ?? '')}.` };
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
  if (!task) return { output: `No background task ${String(args.id ?? '')}.` };
  if (task.status === 'running') {
    return { output: `Task ${task.id} is still running. Poll task_status.` };
  }
  const collected = backgroundOutput.get(task.id) ?? [];
  background.delete(task.id);
  backgroundOutput.delete(task.id);
  return {
    output: collected.length ? collected.join('\n') : task.response || '(no output)',
    metadata: { status: task.status, childSessionId: task.childSessionId },
  };
}

export async function taskCancelRunner(args: Record<string, any>): Promise<ToolRunPayload> {
  const task = background.get(String(args.id ?? ''));
  if (!task) return { output: `No background task ${String(args.id ?? '')}.` };
  task.controller.abort();
  task.status = 'cancelled';
  return { output: `Cancelled ${task.id}.` };
}

function startBackground(options: {
  category: string;
  prompt: string;
  maxTurns: number;
  ctx: ToolContext;
}): BackgroundTask {
  const runtime = runtimeFor(options.ctx);
  const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const controller = new AbortController();
  const task: BackgroundTask = {
    id,
    category: options.category,
    prompt: options.prompt,
    status: 'running',
    startedAt: Date.now(),
    controller,
  };
  background.set(id, task);
  backgroundOutput.set(id, []);

  void delegate({
    command: runtime.command,
    args: [...runtime.args, '--max-turns', String(options.maxTurns)],
    category: options.category,
    prompt: options.prompt,
    cwd: options.ctx.projectRoot,
    registry: runtime.registry,
    categories: runtime.categories,
    config: runtime.delegation,
    depth: depthOf(options.ctx),
    running: background.size - 1,
    signal: controller.signal,
    onEvent: (event) => {
      if (event.type === 'text' && event.delta) {
        const lines = backgroundOutput.get(id) ?? [];
        lines.push(event.delta);
        backgroundOutput.set(id, lines);
      }
    },
  })
    .then((outcome) => {
      task.status = outcome.status === 'ok' ? 'ok' : outcome.status;
      task.response = outcome.response;
      task.resolvedModel = outcome.resolvedModel;
      task.childSessionId = outcome.childSessionId;
      task.reason = outcome.reason;
      const lines = backgroundOutput.get(id) ?? [];
      lines.push(delegationTranscriptLine({
        category: outcome.category,
        resolvedModel: outcome.resolvedModel ?? 'unresolved',
        childSessionId: outcome.childSessionId ?? 'unknown',
        status: outcome.status,
      }));
      backgroundOutput.set(id, lines);
    })
    .catch((error: any) => {
      task.status = 'error';
      task.reason = error?.message ?? String(error);
    });

  return task;
}

export interface DelegationRuntime {
  command: string;
  args: string[];
  registry: any;
  categories: any;
  delegation?: DelegationConfig;
}

const runtimeCache = new Map<string, DelegationRuntime>();

export const configureDelegationRuntime = (runtime: DelegationRuntime) => {
  runtimeCache.set('current', runtime);
};

const runtimeFor = (_ctx: ToolContext): DelegationRuntime =>
  runtimeCache.get('current') ?? {
    command: process.execPath,
    args: [process.argv[1] ?? 'jamcli'],
    registry: undefined,
    categories: undefined,
    delegation: undefined,
  };

export const TASK_TOOLS: RegisteredTool[] = [
  {
    name: 'task',
    description:
      'Delegate work to a child agent run on a model chosen by category. Returns the child result, or an id when background is set.',
    inputSchema: taskSchema,
    policy: 'execute',
    runner: taskRunner,
  },
  {
    name: 'task_status',
    description: 'Report the status of a background delegated task.',
    inputSchema: statusSchema,
    policy: 'read',
    runner: taskStatusRunner,
  },
  {
    name: 'task_result',
    description: 'Collect the output of a finished background delegated task.',
    inputSchema: statusSchema,
    policy: 'read',
    runner: taskResultRunner,
  },
  {
    name: 'task_cancel',
    description: 'Cancel a running background delegated task.',
    inputSchema: cancelSchema,
    policy: 'write',
    runner: taskCancelRunner,
  },
];
