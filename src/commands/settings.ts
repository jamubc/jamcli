import path from 'path';
import { userConfigFile } from '../core/config/load.js';
import { configJsonSchema } from '../core/config/schema.js';

/** One setting a person can change, as the configuration schema describes it. */
export interface Setting {
  key: string;
  kind: 'boolean' | 'enum' | 'text' | 'list' | 'map';
  description?: string;
  /** The values it takes, for a boolean or an enum. */
  choices?: string[];
}

/** Keys never offered here: a key's own text belongs in the credential store, and editors read $schema. */
const HIDDEN = /(^|\.)(api_key|\$schema)$/;

/** Every setting in the schema, in its order, down to the values a person sets one by one. */
export function settingsFromSchema(schema: any = configJsonSchema()): Setting[] {
  const found: Setting[] = [];
  const walk = (node: any, key: string) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object' && node.properties) {
      for (const [name, child] of Object.entries(node.properties)) walk(child, key ? `${key}.${name}` : name);
      return;
    }
    if (HIDDEN.test(key)) return;
    const description = typeof node.description === 'string' ? node.description : undefined;
    const base = { key, ...(description ? { description } : {}) };
    if (Array.isArray(node.enum)) found.push({ ...base, kind: 'enum', choices: node.enum.map(String) });
    else if (node.type === 'boolean') found.push({ ...base, kind: 'boolean', choices: ['true', 'false'] });
    else if (node.type === 'array') found.push({ ...base, kind: 'list' });
    else if (node.type === 'object') found.push({ ...base, kind: 'map' });
    else found.push({ ...base, kind: 'text' });
  };
  walk(schema, '');
  return found;
}

export type SettingScope = 'user' | 'project' | 'local';

/** Where a value comes from, in plain words, and the file a change to it is written to. */
export function originOf(origin: string | undefined, projectRoot: string): { words: string; scope?: SettingScope } {
  if (!origin || origin === 'defaults') return { words: 'default' };
  if (path.resolve(origin) === path.resolve(userConfigFile())) return { words: 'your settings', scope: 'user' };
  if (path.resolve(origin) === path.join(projectRoot, '.jamcli', 'config.local.json')) return { words: 'this project, just you', scope: 'local' };
  if (path.resolve(origin) === path.join(projectRoot, '.jamcli', 'config.json')) return { words: 'this project', scope: 'project' };
  return { words: origin };
}

export const SCOPE_WORDS: Record<SettingScope, string> = {
  user: 'your settings, for every project',
  project: "this project's .jamcli/config.json",
  local: "this project's .jamcli/config.local.json, just for you",
};
