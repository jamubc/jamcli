import type { Config } from '../../types/config.js';
import { chainsOf, describeSource, type LoadedAgents } from '../ext/agents.js';
import { displayPath } from '../config/load.js';
import { downgradeReasoning } from '../routing/capabilities.js';
import { resolveRoute } from '../routing/resolve.js';
import { isChainReachable } from '../routing/reachable.js';
import type { Delegate, DelegationOutcome, DelegationRequest } from '../delegation/types.js';
import type { McpSource } from './tools.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { WorkTable } from '../work.js';
import type { Runtime, RuntimeOptions } from './index.js';
import type { Sandbox } from '../sandbox/types.js';
import type { AgentEvent } from '../types.js';
import { describeWorktree, openWorktree, removeWorktree, worktreeChanges, type Worktree } from '../git/worktrees.js';

export type UsageEvent = Extract<AgentEvent, { type: 'usage' }>;

/** What a child inherits from the session that delegates to it. */
export interface ParentSession {
  sessionId: string;
  depth: number;
  /** The parent's permission engine, which the child's own is derived from. */
  permissions: PermissionEngine;
  /** The parent's work table, so what a child starts is the person's to see and stop too. */
  work: WorkTable;
  /** The model the parent is on now, as `provider:model`, which an agent without a chain runs on. */
  model: string;
}

export interface ChildLauncherOptions {
  projectRoot: string;
  config: Config;
  /** The session's agents, loaded once so routing agrees with what the model was shown. */
  agents: LoadedAgents;
  parent: () => ParentSession;
  mcp?: McpSource;
  env?: Record<string, string | undefined>;
  /** The parent's sandbox, which the child's commands run in too. */
  sandbox?: Sandbox;
  create: (options: RuntimeOptions) => Promise<Runtime>;
  /** Each request a child makes, marked with the session that made it, so the parent can count it. */
  onUsage?: (event: UsageEvent) => void;
  /** The parent's observer and the span a child starts under, so a delegated run shares its trace. */
  observer?: () => RuntimeOptions['observer'];
}

/** MCP connections belong to the parent, so a child uses them without closing them. */
const borrowed = (mcp: McpSource): McpSource => ({
  listServers: () => mcp.listServers(),
  listServerTools: (server) => mcp.listServerTools(server),
  callServerTool: (descriptor, args) => mcp.callServerTool(descriptor, args),
});

const STATUS: Record<string, DelegationOutcome['status']> = { ok: 'ok', cancelled: 'cancelled', limit: 'limit', refused: 'refused' };

/**
 * Children run in this process as runtimes of their own, with their own session. A child
 * decides with an engine derived from its parent's, so nothing it is configured with can
 * widen what the parent allows, and what it narrows stays its own. What the parent would ask about, the child asks the parent's
 * surface, in the background too; where nobody can answer, the call is not made.
 */
export function childLauncher(options: ChildLauncherOptions): Delegate {
  const { agents, defaultAgent } = options.agents;
  const names = Object.keys(agents).sort().join(', ');
  return async (request) => {
    const name = request.agent ?? defaultAgent;
    const refuse = (reason: string): DelegationOutcome => ({ status: 'refused', response: '', agent: name ?? '', reason });
    if (!name) return refuse(`Name an agent: none is the default. The agents are ${names}.`);
    const agent = agents[name];
    if (!agent) return refuse(`No agent named "${name}". The agents are ${names}.`);
    const parent = options.parent();
    let model = parent.model;
    let chainReasoning: DelegationRequest['reasoning'];
    let chainEffort: DelegationRequest['effort'] = agent.effort;
    if (!agent.inherits) {
      const route = await resolveRoute({
        registry: options.config.api_registry,
        categories: chainsOf(agents),
        category: name,
        isReachable: (candidate) => isChainReachable(candidate, options.config.api_registry),
      });
      if (!route?.model) return refuse(route?.notes.join(' ') || `No model in "${name}" can serve it.`);
      model = route.model;
      chainReasoning = route.reasoning;
      chainEffort = route.effort;
    }
    // The call's level replaces the chain entry's, and is held to what the model accepts.
    const reasoning = request.reasoning ? downgradeReasoning(request.reasoning, model).level : chainReasoning;
    const effort = request.effort ?? chainEffort;

    let tree: Worktree | undefined;
    if (request.isolation === 'worktree') {
      try {
        tree = await openWorktree(options.projectRoot, `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
      } catch (error: any) {
        return refuse(`The task could not have a worktree: ${error?.message ?? error}`);
      }
    }

    let child: Runtime;
    try {
      child = await options.create({
        projectRoot: options.projectRoot,
        ...(tree ? { workTree: tree.dir } : {}),
        surface: 'child',
        model,
        ...(reasoning ? { reasoning } : {}),
        ...(effort ? { effort } : {}),
        ...(agent.rules ? { agentRules: { agent: name, source: describeSource(agent.source, (file) => displayPath(file, options.projectRoot)), text: agent.rules } } : {}),
        maxSteps: request.maxTurns,
        signal: request.signal,
        mcp: options.mcp ? borrowed(options.mcp) : false,
        env: options.env,
        sandbox: options.sandbox,
        parent,
        ...(request.heard ? { heard: request.heard } : {}),
        observer: options.observer?.(),
      });
    } catch (error: any) {
      if (tree) await removeWorktree(tree, { branch: true }).catch(() => undefined);
      return { status: 'error', response: '', agent: name, resolvedModel: model, reason: error?.message ?? String(error) };
    }

    try {
      request.onStart?.({ agent: name, model, sessionId: child.sessionId });
      // The calls the parent's surface was asked about, whose results it shows under the prompt it gave.
      const asked = new Set<string>();
      const result = await child.run(request.prompt, (event) => {
        request.onEvent?.(event);
        if (event.type === 'text') request.onText?.(event.delta);
        if (event.type === 'tool_result' && asked.has(event.result.callId ?? '')) request.onResult?.(event.result);
        // A grandchild's request keeps the session that made it.
        if (event.type === 'usage') options.onUsage?.({ ...event, delegatedSession: event.delegatedSession ?? child.sessionId });
        if (event.type !== 'approval_request') return;
        // A child asks whoever answers its parent's calls, in the background too: the surface
        // that started the parent can still answer after the call that started the child returned.
        if (!request.requestApproval) {
          event.decide({ allow: false, by: 'mode', feedback: 'nobody can answer a child task here, so this call was not made.' });
          return;
        }
        asked.add(event.call.id);
        void request.requestApproval({ call: event.call, request: event.request }).then((decision) =>
          event.decide(decision === 'cancelled' ? { allow: false, by: 'mode', feedback: 'the parent turn was cancelled.' } : decision)
        );
      });
      return {
        status: STATUS[result.status] ?? 'error',
        response: result.response,
        agent: name,
        resolvedModel: model,
        childSessionId: child.sessionId,
        ...(result.error ? { reason: result.error } : {}),
        ...(tree ? await settleWorktree(tree, options.projectRoot) : {}),
      };
    } finally {
      await child.close();
    }
  };
}

/**
 * An isolated child's worktree once it is done: kept, and reported, when it holds
 * anything; taken away with its branch when the child changed nothing.
 */
async function settleWorktree(tree: Worktree, projectRoot: string): Promise<Pick<DelegationOutcome, 'worktree'>> {
  try {
    const changes = await worktreeChanges(tree);
    if (!changes.commits && !changes.uncommitted.length) {
      await removeWorktree(tree, { branch: true });
      return {};
    }
    return { worktree: { path: tree.root, branch: tree.branch, summary: describeWorktree(tree, changes, projectRoot) } };
  } catch (error: any) {
    return { worktree: { path: tree.root, branch: tree.branch, summary: `The worktree ${tree.root}, on branch ${tree.branch}, could not be read: ${error?.message ?? error}` } };
  }
}
