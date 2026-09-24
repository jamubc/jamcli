import type { Config } from '../../types/config.js';
import { DEFAULT_CATEGORIES } from '../routing/categories.js';
import { resolveRoute } from '../routing/resolve.js';
import type { Delegate, DelegationOutcome } from '../delegation/types.js';
import type { ConfigService } from '../../services/ConfigService.js';
import type { McpSource } from './tools.js';
import type { ToolPolicy } from './policy.js';
import type { Runtime, RuntimeOptions } from './index.js';

/** What a child inherits from the session that delegates to it. */
export interface ParentSession {
  sessionId: string;
  depth: number;
  policy: ToolPolicy;
}

export interface ChildLauncherOptions {
  projectRoot: string;
  config: Config;
  configService: ConfigService;
  parent: () => ParentSession;
  mcp?: McpSource;
  env?: Record<string, string | undefined>;
  create: (options: RuntimeOptions) => Promise<Runtime>;
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
 * decides with its parent's policy, so nothing it is configured with can widen what the
 * parent allows. What the parent would ask about, the child asks the parent's surface,
 * unless it runs in the background, where nobody can answer and the call is not made.
 */
export function childLauncher(options: ChildLauncherOptions): Delegate {
  return async (request) => {
    const categories = categoriesOf(options.config);
    const route = await resolveRoute({ registry: options.config.api_registry, categories, category: request.category });
    const refuse = (reason: string): DelegationOutcome => ({ status: 'refused', response: '', category: request.category, reason });
    if (!route) return refuse(`No category named "${request.category}". The categories are ${Object.keys(categories).join(', ')}.`);
    if (!route.model) return refuse(route.notes.join(' '));

    let child: Runtime;
    try {
      child = await options.create({
        projectRoot: options.projectRoot,
        surface: 'child',
        model: route.model,
        maxSteps: request.maxTurns,
        signal: request.signal,
        mcp: options.mcp ? borrowed(options.mcp) : false,
        env: options.env,
        configService: options.configService,
        parent: options.parent(),
      });
    } catch (error: any) {
      return { status: 'error', response: '', category: request.category, resolvedModel: route.model, reason: error?.message ?? String(error) };
    }

    try {
      const result = await child.run(request.prompt, (event) => {
        if (event.type === 'text') request.onText?.(event.delta);
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
      };
    } finally {
      await child.close();
    }
  };
}
