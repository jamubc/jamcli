import fs from 'fs';
import path from 'path';
import { readManifest, type PluginManifest } from './manifest.js';
import { enabledPlugins, type LockedPlugin, type PluginScope } from './store.js';

export interface LoadedPlugin extends LockedPlugin {
  scope: PluginScope;
  manifest: PluginManifest;
}

/**
 * The enabled plugins with their manifests, read from their installed copies. One whose
 * manifest no longer reads is left out, with why.
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

/** The directories of commands the enabled plugins contribute, each named under its plugin. */
export function pluginCommandDirs(projectRoot: string): { plugin: string; dir: string }[] {
  return loadPlugins(projectRoot).plugins.flatMap((plugin) => (plugin.manifest.contributes?.commands ? [{ plugin: plugin.name, dir: path.join(plugin.dir, plugin.manifest.contributes.commands) }] : []));
}

/** The directories of skills the enabled plugins contribute. */
export function pluginSkillDirs(projectRoot: string): string[] {
  return loadPlugins(projectRoot).plugins.flatMap((plugin) => (plugin.manifest.contributes?.skills ? [path.join(plugin.dir, plugin.manifest.contributes.skills)] : []));
}

/** A plugin's hooks file: the same shape as the configuration's `hooks` block. */
export function pluginHooks(plugin: LoadedPlugin): Record<string, { command: string; matcher?: string; timeout_ms?: number; enabled?: boolean }[]> {
  if (!plugin.manifest.contributes?.hooks) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(plugin.dir, plugin.manifest.contributes.hooks), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
