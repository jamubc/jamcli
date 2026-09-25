import path from 'path';
import { detectSandbox } from '../sandbox/detect.js';
import type { Sandbox, SandboxSettings } from '../sandbox/types.js';
import { USER_HOOK_EVENTS, type HookCommand } from '../hooks/commands.js';
import type { McpServerConfig } from '../../types/mcp.js';
import fs from 'fs';
import { readManifest, type PluginManifest } from './manifest.js';
import { enabledPlugins, type LockedPlugin, type PluginScope } from './lock.js';

export interface LoadedPlugin extends LockedPlugin {
  scope: PluginScope;
  manifest: PluginManifest;
}

/**
 * The enabled plugins with their manifests checked again, read from their installed
 * copies. One whose manifest no longer reads is left out, with why.
 */
export function loadPlugins(projectRoot: string): { plugins: LoadedPlugin[]; problems: string[] } {
  const plugins: LoadedPlugin[] = [];
  const problems: string[] = [];
  for (const plugin of enabledPlugins(projectRoot)) {
    try {
      plugins.push({ ...plugin, manifest: readManifest(plugin.dir) });
    } catch (error: any) {
      problems.push(`Plugin ${plugin.name} was not loaded: ${error?.message ?? error}`);
    }
  }
  return { plugins, problems };
}

/** A plugin's hooks file: the same shape as the configuration's `hooks` block. */
function pluginHooks(plugin: LoadedPlugin): Record<string, { command: string; matcher?: string; timeout_ms?: number; enabled?: boolean }[]> {
  if (!plugin.manifest.contributes?.hooks) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(plugin.dir, plugin.manifest.contributes.hooks), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const shellQuote = (value: string) => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`);

/** How one plugin's code runs: its sandbox, sized to what it declared, and its environment. */
export interface PluginProcess {
  plugin: LoadedPlugin;
  sandbox: Sandbox;
  env: Record<string, string>;
  hooks: HookCommand[];
}

export interface PluginParts {
  processes: PluginProcess[];
  /** The MCP servers the plugins bring, already wrapped in their sandboxes. */
  servers: McpServerConfig[];
  notices: string[];
}

/**
 * The runnable parts of the enabled plugins. Each runs in a sandbox of its own: the
 * network only if it declared a host, the project writable only if it declared
 * `filesystem: project`, and the session's minimal environment plus the variables it named.
 */
export function pluginParts(
  plugins: LoadedPlugin[],
  options: { projectRoot: string; sandboxSettings: SandboxSettings; envFor: (passthrough: string[]) => Record<string, string> }
): PluginParts {
  const processes: PluginProcess[] = [];
  const servers: McpServerConfig[] = [];
  const notices: string[] = [];
  for (const plugin of plugins) {
    const sandbox = detectSandbox({
      projectRoot: options.projectRoot,
      settings: {
        ...options.sandboxSettings,
        network: plugin.permissions.network.length > 0,
        writable: [],
        readOnlyProject: plugin.permissions.filesystem !== 'project',
        readable: [plugin.dir],
      },
    });
    const env = options.envFor(plugin.permissions.env);
    const hooks: HookCommand[] = [];
    const file = pluginHooks(plugin);
    for (const event of USER_HOOK_EVENTS) {
      for (const setting of file[event] ?? []) {
        if (typeof setting?.command !== 'string') continue;
        hooks.push({ ...setting, event, scope: 'plugin', source: `plugin ${plugin.name}` });
      }
    }
    for (const [id, server] of Object.entries(plugin.manifest.contributes?.mcpServers ?? {})) {
      const command = server.command.startsWith('.') ? path.join(plugin.dir, server.command) : server.command;
      const wrapped = sandbox.wrap([command, ...(server.args ?? [])].map(shellQuote).join(' '), { cwd: plugin.dir, env });
      servers.push({ id: `${plugin.name}-${id}`, title: `${id} from plugin ${plugin.name}`, command: wrapped.file, args: wrapped.args, cwd: plugin.dir, env_passthrough: plugin.permissions.env, enabled: true });
    }
    if (sandbox.kind === 'none' && (hooks.length || plugin.manifest.contributes?.mcpServers)) {
      notices.push(`Plugin ${plugin.name} runs without a sandbox here (${sandbox.reason}), so it can reach more than it declared.`);
    }
    processes.push({ plugin, sandbox, env, hooks });
  }
  return { processes, servers, notices };
}
