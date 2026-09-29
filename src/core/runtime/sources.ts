import type { McpServerConfig } from '../../types/mcp.js';
import { loadSkills, type Skill } from '../ext/skills.js';
import type { ElicitationAnswer, ElicitationRequest } from '../mcp/connect.js';
import { parseRule, type Rule } from '../permissions/rules.js';
import { enabledPlugins, installedPlugins, verifyPlugins } from '../plugins/lock.js';
import type { PluginParts } from '../plugins/runtime.js';
import type { SandboxSettings } from '../sandbox/index.js';
import type { ToolRegistry } from '../tools/registry.js';
import { skillTool } from '../tools/skill.js';
import type { McpSource } from './tools.js';

/**
 * The skills found, registered as the skill tool. A skill's `allowed-tools` narrow what may
 * run through `narrow`, which returns the rules that then hold, for the model to read.
 */
export function registerSkills(registry: ToolRegistry, projectRoot: string, narrow: (rules: Rule[], label: string) => Rule[]): { skills: Skill[]; notices: string[] } {
  const found = loadSkills(projectRoot);
  const notices = found.problems.map((problem) => `A skill was not loaded: ${problem}`);
  if (found.skills.length) {
    registry.register(
      skillTool({
        skills: found.skills,
        activate: (skill) => {
          if (!skill.allowedTools) return undefined;
          const label = `the skill ${skill.name}`;
          const rules = skill.allowedTools.flatMap((text) => {
            const parsed = parseRule(text, 'allow', 'session', `${label} allowed-tools`);
            return 'rule' in parsed ? [parsed.rule] : [];
          });
          const holding = narrow(rules, label);
          return `While this skill is active, until this turn ends, only these tools may run: ${holding.map((rule) => rule.text).join(', ') || 'none'}.`;
        },
      })
    );
  }
  return { skills: found.skills, notices };
}

/**
 * The enabled plugins' runnable parts. A session that owns its plugins hashes each installed
 * copy again and turns off one that changed. The code that loads them is imported only when
 * one is on, so a session without any pays nothing.
 */
export async function sessionPlugins(options: {
  projectRoot: string;
  /** Hash each installed copy again; a delegated run leaves that to its parent. */
  verify: boolean;
  sandboxSettings: SandboxSettings;
  envFor: (passthrough?: string[]) => Record<string, string>;
}): Promise<{ plugins: PluginParts; notices: string[] }> {
  const { projectRoot } = options;
  const notices: string[] = [];
  if (options.verify && installedPlugins(projectRoot).length) {
    for (const result of verifyPlugins(projectRoot)) {
      if (!result.ok) notices.push(`Plugin ${result.name} is off: ${result.problem}. Install it again to use it.`);
    }
  }
  if (!enabledPlugins(projectRoot).length) return { plugins: { processes: [], servers: [], notices: [] }, notices };
  const { loadPlugins, pluginParts } = await import('../plugins/runtime.js');
  const loaded = loadPlugins(projectRoot);
  notices.push(...loaded.problems);
  const parts = pluginParts(loaded.plugins, { projectRoot, sandboxSettings: options.sandboxSettings, envFor: (passthrough) => options.envFor(passthrough) });
  notices.push(...parts.notices);
  return { plugins: parts, notices };
}

/**
 * Where a session's MCP tools come from: the source it was given, none when told so, or a
 * manager of the configured and plugins' servers. The MCP client is imported only when a
 * server is configured: it is the heaviest import a session would otherwise make for nothing.
 */
export async function sessionMcp(options: {
  given: McpSource | false | undefined;
  projectRoot: string;
  servers: McpServerConfig[];
  pluginServers: McpServerConfig[];
  env: Record<string, string | undefined>;
  envFor: (passthrough?: string[], values?: Record<string, string>) => Record<string, string>;
  elicit: (request: ElicitationRequest) => Promise<ElicitationAnswer>;
}): Promise<McpSource | undefined> {
  if (options.given === false) return undefined;
  if (options.given) return options.given;
  if (!options.servers.some((server) => server.enabled !== false) && !options.pluginServers.length) return undefined;
  const [{ McpManager }, { StoredOAuthProvider }, { transportKind }, { detectStore }] = await Promise.all([
    import('../../services/McpManager.js'),
    import('../mcp/oauth.js'),
    import('../mcp/connect.js'),
    import('../config/credentials.js'),
  ]);
  let store: ReturnType<typeof detectStore> | undefined;
  return new McpManager({
    servers: options.servers,
    envFor: (server) => options.envFor(server.env_passthrough, server.env),
    // A signed-in HTTP server's tokens come from the credential store; signing in is `jamcli mcp login`.
    authFor: (server) => (transportKind(server) === 'http' ? new StoredOAuthProvider(server, (store ??= detectStore(options.env))) : undefined),
    elicit: options.elicit,
    extraServers: options.pluginServers,
  });
}
