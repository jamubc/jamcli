import type { Config } from '../../types/config.js';
import { DEFAULT_CATEGORIES } from '../routing/categories.js';
import { resolveRoute } from '../routing/resolve.js';
import type { Delegate, DelegationOutcome } from '../delegation/types.js';
import type { ConfigService } from '../../services/ConfigService.js';
import type { McpSource } from './tools.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { Runtime, RuntimeOptions } from './index.js';
import type { Sandbox } from '../sandbox/types.js';
import type { AgentEvent } from '../types.js';
import { describeWorktree, openWorktree, removeWorktree, worktreeChanges, type Worktree } from '../git/worktrees.js';

export type UsageEvent = Extract<AgentEvent, { type: 'usage' }>;

/** What a child inherits from the session that delegates to it. */
export interface ParentSession {
  sessionId: string;
  depth: number;
  /** The parent's permission engine, which the child decides with. */
  permissions: PermissionEngine;
}

export interface ChildLauncherOptions {
  projectRoot: string;
  config: Config;
  configService?: ConfigService;
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

/** The categories in effect: the configured ones, or the documented defaults. */
export const categoriesOf = (config: Config) =>
  config.categories && Object.keys(config.categories).length ? config.categories : DEFAULT_CATEGORIES;

/** MCP connections belong to the parent, so a child uses them without closing them. */
const borrowed = (mcp: McpSource): McpSource => ({
  listServers: () => mcp.listServers(),
  listServerTools: (server) => mcp.listServerTools(server),
  callServerTool: (descriptor, args) => mcp.callServerTool(descriptor, args),
});

const STATUS: Record<string, DelegationOutcome['status']> = { ok: 'ok', cancelled: 'cancelled', limit: 'limit', refused: 'refused' };

/**
 * Children run in this process as runtimes of their own, with their own session. A child
 * decides with its parent's permission engine, so nothing it is configured with can widen
 * what the parent allows. What the parent would ask about, the child asks the parent's surface,
 * unless it runs in the background, where nobody can answer and the call is not made.
 */
export function childLauncher(options: ChildLauncherOptions): Delegate {
  return async (request) => {
    const categories = categoriesOf(options.config);
    const route = await resolveRoute({ registry: options.config.api_registry, categories, category: request.category });
    const refuse = (reason: string): DelegationOutcome => ({ status: 'refused', response: '', category: request.category, reason });
    if (!route) return refuse(`No category named "${request.category}". The categories are ${Object.keys(categories).join(', ')}.`);
    if (!route.model) return refuse(route.notes.join(' '));

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
        model: route.model,
        maxSteps: request.maxTurns,
        signal: request.signal,
        mcp: options.mcp ? borrowed(options.mcp) : false,
        env: options.env,
        ...(options.configService ? { configService: options.configService } : {}),
        sandbox: options.sandbox,
        parent: options.parent(),
        observer: options.observer?.(),
      });
    } catch (error: any) {
      if (tree) await removeWorktree(tree, { branch: true }).catch(() => undefined);
      return { status: 'error', response: '', category: request.category, resolvedModel: route.model, reason: error?.message ?? String(error) };
    }

    try {
      const result = await child.run(request.prompt, (event) => {
        if (event.type === 'text') request.onText?.(event.delta);
        // A grandchild's request keeps the session that made it.
        if (event.type === 'usage') options.onUsage?.({ ...event, delegatedSession: event.delegatedSession ?? child.sessionId });
        if (event.type !== 'approval_request') return;
        if (request.background || !request.requestApproval) {
          event.decide({ allow: false, by: 'mode', feedback: 'a background task cannot ask for approval, so this call was not made.' });
          return;
        }
        void request.requestApproval({ call: event.call, request: event.request }).then((decision) =>
          event.decide(decision === 'cancelled' ? { allow: false, by: 'mode', feedback: 'the parent turn was cancelled.' } : decision)
        );
      });
      return {
        status: STATUS[result.status] ?? 'error',
        response: result.response,
        category: request.category,
        resolvedModel: route.model,
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
