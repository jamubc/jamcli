import { createBuiltinRegistry, type ToolRegistry } from '../tools/registry.js';
import type { JsonSchema, RegisteredTool, ToolContext } from '../../types/tools.js';
import type { McpServerConfig, McpToolDescriptor } from '../../types/mcp.js';
import type { ToolDispatcher } from '../tools/dispatch.js';
import type { ToolDefinition } from '../providers/types.js';
import type { PolicyClass } from '../types.js';
import { createToolPolicy, type ToolPolicy, type ToolPolicyOptions } from './policy.js';

/** A tool as the model is offered it. */
export interface ToolSummary {
  name: string;
  description: string;
  parameters: JsonSchema;
  policyClass: PolicyClass;
  source: 'builtin' | 'mcp';
  server?: string;
}

/** What the runtime needs from MCP: the configured servers, their tools, and a way to call one. */
export interface McpSource {
  listServers(): Promise<McpServerConfig[]>;
  listServerTools(server: McpServerConfig): Promise<McpToolDescriptor[]>;
  callServerTool(descriptor: McpToolDescriptor, args: Record<string, any>): Promise<{ output: string }>;
  close?(): Promise<void>;
}

const MCP_CONNECT_TIMEOUT_MS = 10_000;

const withTimeout = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms / 1000} seconds`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

/**
 * An MCP server tool as a registry entry, so it is validated, decided, and recorded like
 * a built-in. A tool the server marks read-only runs without asking; any other asks.
 */
const mcpTool = (descriptor: McpToolDescriptor, source: McpSource): RegisteredTool => ({
  name: descriptor.name,
  description: descriptor.description || `${descriptor.nativeName ?? descriptor.name} from MCP server ${descriptor.serverId}`,
  inputSchema: descriptor.inputSchema ?? { type: 'object', additionalProperties: true },
  policy: descriptor.annotations?.readOnlyHint ? 'read' : 'execute',
  runner: async (args) => ({ output: (await source.callServerTool(descriptor, args)).output }),
});

/** Register every enabled server's tools. A server that fails is reported and skipped. */
export async function registerMcpTools(
  registry: ToolRegistry,
  source: McpSource,
  notices: string[]
): Promise<Map<string, string>> {
  const servers = new Map<string, string>();
  const configured = (await source.listServers()).filter((server) => server.enabled !== false);
  await Promise.all(
    configured.map(async (server) => {
      try {
        const tools = await withTimeout(source.listServerTools(server), MCP_CONNECT_TIMEOUT_MS, `MCP server ${server.id}`);
        for (const descriptor of tools) {
          registry.register(mcpTool(descriptor, source));
          servers.set(descriptor.name, server.id);
        }
      } catch (error: any) {
        notices.push(`MCP server ${server.id} is unavailable: ${error?.message ?? error}`);
      }
    })
  );
  return servers;
}

export interface ToolSetOptions extends Pick<ToolPolicyOptions, 'permissions' | 'allowTools' | 'denyTools'> {
  registry?: ToolRegistry;
  /** Tool names that came from MCP servers, mapped to their server. */
  mcpServers?: Map<string, string>;
  /** Decide with this policy instead of building one, as a delegated run does with its parent's. */
  policy?: ToolPolicy;
  /** Descriptions to offer instead of a tool's own, such as `task` listing the categories. */
  descriptions?: Record<string, string>;
  /** The context every call runs with, less what each call supplies. */
  context: () => ToolContext;
}

export interface ToolSet {
  registry: ToolRegistry;
  policy: ToolPolicy;
  summaries: ToolSummary[];
  definitions: ToolDefinition[];
  dispatcher: ToolDispatcher;
}

/**
 * The tools of one session: every visible registry tool the policy does not deny, the
 * definitions the model is offered, and the dispatcher that decides and runs calls.
 */
export function createToolSet(options: ToolSetOptions): ToolSet {
  const registry = options.registry ?? createBuiltinRegistry();
  const aliases = new Map<string, string[]>();
  for (const tool of registry.list()) {
    if (tool.aliasOf) aliases.set(tool.aliasOf, [...(aliases.get(tool.aliasOf) ?? []), tool.name]);
  }
  const canonical = (name: string) => registry.get(name)?.aliasOf ?? name;
  const namesOf = (name: string) => {
    const root = canonical(name);
    return [root, ...(aliases.get(root) ?? [])];
  };
  const classOf = (name: string): PolicyClass | 'unknown' => registry.get(name)?.policy ?? 'unknown';

  const policy =
    options.policy ??
    createToolPolicy({
      permissions: options.permissions,
      allowTools: options.allowTools,
      denyTools: options.denyTools,
      classOf,
      namesOf,
      known: (name) => Boolean(registry.get(name)),
    });

  const offered = registry.visible().filter((tool) => policy.decide(tool.name).decision !== 'deny');
  const offeredNames = new Set(offered.map((tool) => tool.name));
  const summaries: ToolSummary[] = offered.map((tool) => {
    const server = options.mcpServers?.get(tool.name);
    return {
      name: tool.name,
      description: options.descriptions?.[tool.name] ?? tool.description,
      parameters: tool.inputSchema,
      policyClass: tool.policy,
      source: server ? 'mcp' : 'builtin',
      ...(server ? { server } : {}),
    };
  });
  const definitions: ToolDefinition[] = summaries.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters as Record<string, unknown> },
  }));

  const dispatcher: ToolDispatcher = {
    listTools: () => summaries.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters as Record<string, unknown> })),
    requiresApproval: (name) => policy.decide(name).decision === 'ask',
    isReadOnly: (name) => classOf(name) === 'read',
    approvalReason: (call) => policy.decide(call.name).reason,
    policyClass: classOf,
    autoApproval: (call) => {
      const verdict = policy.decide(call.name);
      return verdict.decision === 'allow' && classOf(call.name) !== 'read' ? { by: verdict.by, rule: verdict.rule } : undefined;
    },
    execute: async (call, context) => {
      if (!offeredNames.has(canonical(call.name))) {
        return {
          tool: call.name,
          status: 'error',
          success: false,
          output: `Tool ${call.name} is not available in this session.`,
          durationMs: 0,
        };
      }
      const result = await registry.execute(call.name, call.arguments ?? {}, {
        ...options.context(),
        signal: context?.signal,
        onProgress: context?.onProgress,
        requestApproval: context?.requestApproval,
      });
      return {
        tool: call.name,
        success: result.success,
        status: result.status,
        output: result.output,
        durationMs: result.durationMs,
        ...(result.metadata ? { metadata: result.metadata } : {}),
      };
    },
  };

  return { registry, policy, summaries, definitions, dispatcher };
}
