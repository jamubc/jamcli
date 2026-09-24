import fs from 'fs';
import path from 'path';
import {
  displayPath,
  loadConfig,
  localConfigFile,
  mcpFile,
  projectConfigFile,
  readJsonFile,
  userConfigFile,
  type LoadedConfig,
} from '../core/config/load.js';
import { ConfigFileSchema } from '../core/config/schema.js';
import { formatPath, validateLayer } from '../core/config/validate.js';
import { getAt, maskSecrets, parseKeyPath, setAt, unsetAt, type KeyPath } from '../core/config/keys.js';
import { legacyRules } from '../core/permissions/config.js';
import { ensureProjectStateDir } from '../core/transcript/log.js';

export type ConfigAction = 'list' | 'get' | 'set' | 'unset' | 'migrate';
export const CONFIG_ACTIONS: readonly ConfigAction[] = ['list', 'get', 'set', 'unset', 'migrate'];

export interface ConfigCommandRequest {
  action: ConfigAction;
  args: string[];
}

export interface ConfigCommandIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const defaultIo: ConfigCommandIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

export const CONFIG_USAGE = `Usage:
  jamcli config list [--show-origin] [--json]   Every value set, from every layer
  jamcli config get <key> [--show-origin]       One value, such as agent_loop.max_steps
  jamcli config set <key> <value> [--scope s]   Set a value; s is project (default), local, or user
  jamcli config unset <key> [--scope s]         Remove a value from one file
  jamcli config migrate [--dry-run]             Move .jamcli/mcp.json tool settings into permission rules

Values are read as JSON when they parse as JSON, and as text otherwise.
Name a key with dots in it in brackets: models["ollama:qwen2.5-coder:7b"].context_window`;

type Scope = 'user' | 'project' | 'local';

interface Flags {
  positional: string[];
  showOrigin: boolean;
  json: boolean;
  dryRun: boolean;
  scope?: string;
  unknown: string[];
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { positional: [], showOrigin: false, json: false, dryRun: false, unknown: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--show-origin') flags.showOrigin = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--scope') flags.scope = args[++index];
    else if (arg.startsWith('--scope=')) flags.scope = arg.slice('--scope='.length);
    else if (arg.startsWith('--') && arg.length > 2) flags.unknown.push(arg);
    else flags.positional.push(arg);
  }
  return flags;
}

const scopeFile = (scope: Scope, projectRoot: string) =>
  scope === 'user' ? userConfigFile() : scope === 'local' ? localConfigFile(projectRoot) : projectConfigFile(projectRoot);

/** A value as the command line gives it: JSON when it parses, text otherwise. */
export const parseValue = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const show = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));

/** Every value set, as `formatPath` keys: the configuration, then the active profile, then the legacy mcp.json. */
function rootFor(settings: LoadedConfig) {
  return { ...settings.config, profile: settings.profile, mcp: settings.mcp };
}

function writeFile(file: string, value: unknown, scope: Scope, projectRoot: string): void {
  if (scope === 'user') fs.mkdirSync(path.dirname(file), { recursive: true });
  else ensureProjectStateDir(projectRoot);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** A free name for a backup of `file`: `file.bak`, then `file.bak.2`, and so on. */
function backupName(file: string): string {
  let candidate = `${file}.bak`;
  for (let index = 2; fs.existsSync(candidate); index += 1) candidate = `${file}.bak.${index}`;
  return candidate;
}

export async function runConfigCommand(request: ConfigCommandRequest, projectRoot: string, io: ConfigCommandIo = defaultIo): Promise<number> {
  const flags = parseFlags(request.args);
  if (flags.unknown.length) {
    io.err(`Unknown option: ${flags.unknown.join(', ')}\n\n${CONFIG_USAGE}`);
    return 2;
  }
  const scope = (flags.scope ?? 'project') as Scope;
  if (!['user', 'project', 'local'].includes(scope)) {
    io.err(`--scope is user, project, or local, not ${flags.scope}.`);
    return 2;
  }
  const label = (file: string) => displayPath(file, projectRoot);

  if (request.action === 'list' || request.action === 'get') {
    const settings = loadConfig({ projectRoot });
    for (const error of settings.errors) io.err(`warning: ${error}`);
    const root = rootFor(settings);
    if (request.action === 'list') {
      const entries = [...settings.origins.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, origin]) => {
          const parsed = parseKeyPath(key) as KeyPath;
          return { key, origin, value: maskSecrets(getAt(root, parsed), parsed) };
        });
      if (flags.json) io.out(JSON.stringify(entries, null, 2));
      else for (const entry of entries) io.out(`${flags.showOrigin ? `${entry.origin}\t` : ''}${entry.key} = ${JSON.stringify(entry.value)}`);
      return 0;
    }
    const key = flags.positional[0];
    const parsed = key ? parseKeyPath(key) : { error: CONFIG_USAGE };
    if ('error' in parsed) {
      io.err(parsed.error);
      return 2;
    }
    const value = getAt(root, parsed);
    if (value === undefined) {
      io.err(`${formatPath(parsed)} is not set.`);
      return 1;
    }
    io.out(show(maskSecrets(value, parsed)));
    if (flags.showOrigin) {
      const name = formatPath(parsed);
      const origins = [...new Set([...settings.origins].filter(([k]) => k === name || k.startsWith(`${name}.`) || k.startsWith(`${name}[`)).map(([, origin]) => origin))];
      io.out(`from ${origins.join(', ')}`);
    }
    return 0;
  }

  if (request.action === 'set' || request.action === 'unset') {
    const [key, raw] = flags.positional;
    const parsed = key ? parseKeyPath(key) : { error: CONFIG_USAGE };
    if ('error' in parsed) {
      io.err(parsed.error);
      return 2;
    }
    if (request.action === 'set' && raw === undefined) {
      io.err(`Give a value: jamcli config set ${formatPath(parsed)} <value>`);
      return 2;
    }
    const file = scopeFile(scope, projectRoot);
    const current = readJsonFile(file, label(file));
    if (current.error) {
      io.err(`${current.error} Fix the file first; nothing was changed.`);
      return 1;
    }
    const before = (current.value ?? {}) as Record<string, any>;
    const next = structuredClone(before);
    const name = formatPath(parsed);
    if (request.action === 'unset') {
      if (!unsetAt(next, parsed)) {
        io.err(`${name} is not set in ${label(file)}.`);
        return 1;
      }
    } else {
      const refused = setAt(next, parsed, parseValue(raw));
      if (refused) {
        io.err(`${name} was not set: ${refused}`);
        return 1;
      }
      // Only what this change introduces is refused; a problem already in the file is left to its owner.
      const known = new Set(validateLayer(ConfigFileSchema, before, label(file)).errors);
      const introduced = validateLayer(ConfigFileSchema, next, label(file)).errors.filter((error) => !known.has(error));
      if (introduced.length) {
        for (const error of introduced) io.err(error.replace(/, so it is ignored\.$/, '.'));
        io.err('Nothing was changed.');
        return 1;
      }
    }
    writeFile(file, next, scope, projectRoot);
    io.out(request.action === 'set' ? `Set ${name} in ${label(file)}.` : `Removed ${name} from ${label(file)}.`);
    if (request.action === 'set' && parsed.at(-1) === 'api_key') {
      io.err('A key in a file can be read by anything that reads the file; key_env_var keeps it in the environment instead.');
    }
    const winner = loadConfig({ projectRoot }).origins.get(name);
    if (request.action === 'set' && winner && winner !== label(file)) io.err(`${winner} also sets ${name}, and takes precedence.`);
    return 0;
  }

  // migrate
  const legacy = mcpFile(projectRoot);
  const legacyRead = readJsonFile(legacy, label(legacy));
  const configPath = projectConfigFile(projectRoot);
  const configRead = readJsonFile(configPath, label(configPath));
  for (const error of [legacyRead.error, configRead.error]) {
    if (!error) continue;
    io.err(`${error} Fix the file first; nothing was changed.`);
    return 1;
  }
  const mcp = (legacyRead.value ?? {}) as Record<string, any>;
  if (!mcp.tools || typeof mcp.tools !== 'object') {
    io.out('Nothing to migrate.');
    return 0;
  }
  const rules = legacyRules(mcp.tools, label(legacy));
  const restated = Object.keys(mcp.tools).length - rules.length;
  const config = structuredClone((configRead.value ?? {}) as Record<string, any>);
  const permissions = (config.permissions ??= {});
  const added: string[] = [];
  for (const rule of rules) {
    const list: string[] = (permissions[rule.decision] ??= []);
    if (!list.includes(rule.text)) {
      list.push(rule.text);
      added.push(`${rule.decision} ${rule.text}`);
    }
  }
  if (!Object.keys(permissions).length) delete config.permissions;
  const nextMcp = { ...mcp };
  delete nextMcp.tools;

  const summary = [
    `${label(legacy)} tools holds ${Object.keys(mcp.tools).length} entr${Object.keys(mcp.tools).length === 1 ? 'y' : 'ies'}.`,
    added.length ? `Rules added to ${label(configPath)} permissions: ${added.join('; ')}.` : `No rule needs adding to ${label(configPath)}.`,
    ...(restated ? [`${restated} only restated the defaults and ${restated === 1 ? 'is' : 'are'} dropped.`] : []),
  ];
  if (flags.dryRun) {
    for (const line of summary) io.out(line);
    io.out('Dry run: nothing was changed.');
    return 0;
  }
  const backups: string[] = [];
  for (const file of [legacy, configPath]) {
    if (!fs.existsSync(file)) continue;
    const backup = backupName(file);
    fs.copyFileSync(file, backup);
    backups.push(label(backup));
  }
  writeFile(configPath, config, 'project', projectRoot);
  writeFile(legacy, nextMcp, 'project', projectRoot);
  for (const line of summary) io.out(line);
  io.out(`The tools block was removed from ${label(legacy)}. Backups: ${backups.join(', ')}.`);
  return 0;
}
