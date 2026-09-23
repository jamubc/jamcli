import { delegateToAgent, loadAgentConfigs } from '../../services/AcpClient.js';
import type { AcpAgentConfig } from '../../services/AcpClient.js';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { resolveToolPolicy } from '../policy/index.js';

interface RunningDelegation {
  id: string;
  agent: string;
  status: 'running' | 'ok' | 'error' | 'cancelled';
  response?: string;
  reason?: string;
  controller: AbortController;
  startedAt: number;
}

const running = new Map<string, RunningDelegation>();
const output = new Map<string, string[]>();

const delegateSchema: JsonSchema = {
  type: 'object',
  properties: {
    agent: { type: 'string', description: 'Agent id from .jamcli/agents.json.' },
    prompt: { type: 'string', description: 'Prompt to send to the external agent.' },
    background: { type: 'boolean', description: 'Return an id immediately instead of waiting.' },
    cwd: { type: 'string', description: 'Working directory for the external session.' },
  },
  required: ['agent', 'prompt'],
  additionalProperties: false,
};

const statusSchema: JsonSchema = {
  type: 'object',
  properties: { id: { type: 'string', description: 'Identifier returned by delegate.' } },
  required: ['id'],
  additionalProperties: false,
};

const cancelSchema: JsonSchema = {
  type: 'object',
  properties: { id: { type: 'string', description: 'Identifier returned by delegate.' } },
  required: ['id'],
  additionalProperties: false,
};

const findAgent = async (projectRoot: string, id: string): Promise<AcpAgentConfig | null> => {
  const configs = await loadAgentConfigs(projectRoot);
  return configs.find((config) => config.id === id || config.name === id) ?? null;
};

/**
 * The local policy governs this tool exactly as it governs any other: when the
 * decision is not allow, the run is refused before an external process starts.
 */
export async function delegateToAcpRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const decision = resolveToolPolicy('delegate', {});
  if (decision.decision === 'deny') {
    return { output: `Refused: ${decision.reason}` };
  }

  const agentId = String(args.agent ?? '');
  const prompt = String(args.prompt ?? '');
  const config = await findAgent(ctx.projectRoot, agentId);
  if (!config) {
    return { output: `No agent named "${agentId}" in .jamcli/agents.json.` };
  }

  if (args.background) {
    const id = `acp-${Date.now().toString(36)}`;
    const controller = new AbortController();
    running.set(id, { id, agent: agentId, status: 'running', controller, startedAt: Date.now() });
    output.set(id, []);
    void delegateToAgent(config, prompt, {
      projectRoot: ctx.projectRoot,
      cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
      signal: controller.signal,
      onUpdate: (update) => {
        const text = update?.content?.text;
        if (text) {
          const lines = output.get(id) ?? [];
          lines.push(String(text));
          output.set(id, lines);
        }
      },
    })
      .then((result) => {
        const task = running.get(id);
        if (task) {
          task.status = 'ok';
          task.response = result.response;
        }
      })
      .catch((error: any) => {
        const task = running.get(id);
        if (task) {
          task.status = controller.signal.aborted ? 'cancelled' : 'error';
          task.reason = error?.message ?? String(error);
        }
      });
    return { output: `Started ${id} on agent "${agentId}".`, metadata: { id } };
  }

  try {
    const result = await delegateToAgent(config, prompt, {
      projectRoot: ctx.projectRoot,
      cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
      signal: ctx.signal,
      onPermission: () => ({ outcome: 'cancelled' }),
    });
    return {
      output: [`Agent ${result.agent} stopped with ${result.stopReason}.`, '', result.response].join('\n'),
      metadata: { agent: result.agent, sessionId: result.sessionId },
    };
  } catch (error: any) {
    return { output: `Agent ${agentId} failed: ${error?.message ?? String(error)}` };
  }
}

export async function acpStatusRunner(args: Record<string, any>): Promise<ToolRunPayload> {
  const task = running.get(String(args.id ?? ''));
  if (!task) return { output: `No delegation ${String(args.id ?? '')}.` };
  return {
    output: [
      `${task.id}: ${task.status}`,
      `agent ${task.agent}`,
      `started ${new Date(task.startedAt).toISOString()}`,
      task.reason ? `reason ${task.reason}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export async function acpResultRunner(args: Record<string, any>): Promise<ToolRunPayload> {
  const task = running.get(String(args.id ?? ''));
  if (!task) return { output: `No delegation ${String(args.id ?? '')}.` };
  if (task.status === 'running') return { output: `Delegation ${task.id} is still running.` };
  const collected = output.get(task.id) ?? [];
  running.delete(task.id);
  output.delete(task.id);
  return { output: collected.join('') || task.response || '(no output)' };
}

export async function acpCancelRunner(args: Record<string, any>): Promise<ToolRunPayload> {
  const task = running.get(String(args.id ?? ''));
  if (!task) return { output: `No delegation ${String(args.id ?? '')}.` };
  task.controller.abort();
  task.status = 'cancelled';
  return { output: `Cancelled ${task.id}.` };
}

export const ACP_TOOLS: RegisteredTool[] = [
  {
    name: 'delegate',
    description: 'Delegate one prompt to an external ACP agent configured in .jamcli/agents.json.',
    inputSchema: delegateSchema,
    policy: 'execute',
    runner: delegateToAcpRunner,
  },
  {
    name: 'delegate_status',
    description: 'Report the status of a background ACP delegation.',
    inputSchema: statusSchema,
    policy: 'read',
    runner: acpStatusRunner,
  },
  {
    name: 'delegate_result',
    description: 'Collect the output of a finished ACP delegation.',
    inputSchema: statusSchema,
    policy: 'read',
    runner: acpResultRunner,
  },
  {
    name: 'delegate_cancel',
    description: 'Cancel a running ACP delegation.',
    inputSchema: cancelSchema,
    policy: 'write',
    runner: acpCancelRunner,
  },
];
