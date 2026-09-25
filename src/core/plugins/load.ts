import fs from 'fs';
import path from 'path';
import { enabledPlugins } from './lock.js';

/**
 * Where the enabled plugins' commands and skills are, read from the lockfiles and the
 * manifests as JSON. It stays light, since every command and skill lookup runs it: the
 * manifests were checked at install, and each session start hashes the installed copies.
 */
function contributed(projectRoot: string, key: 'commands' | 'skills'): { plugin: string; dir: string }[] {
  const found: { plugin: string; dir: string }[] = [];
  for (const plugin of enabledPlugins(projectRoot)) {
    try {
      const relative = JSON.parse(fs.readFileSync(path.join(plugin.dir, 'jamcli-plugin.json'), 'utf8'))?.contributes?.[key];
      if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) continue;
      found.push({ plugin: plugin.name, dir: path.join(plugin.dir, relative) });
    } catch {
      // A manifest that no longer reads contributes nothing; the session start says why.
    }
  }
  return found;
}

/** The directories of commands the enabled plugins contribute, each named under its plugin. */
export const pluginCommandDirs = (projectRoot: string) => contributed(projectRoot, 'commands');

/** The directories of skills the enabled plugins contribute. */
export const pluginSkillDirs = (projectRoot: string) => contributed(projectRoot, 'skills').map((entry) => entry.dir);
