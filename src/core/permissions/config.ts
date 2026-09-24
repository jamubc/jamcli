import fs from 'fs';
import path from 'path';
import { TOOL_DEFINITIONS, type ToolName } from '../../types/tools.js';
import type { ToolPermissionValue } from '../../types/config.js';
import { userConfigDir } from '../../utils/paths.js';
import { isPermissionMode, type PermissionMode } from './modes.js';
import { parseRule, type Decision, type Rule, type RuleScope } from './rules.js';

/** The `permissions` block of a configuration file. */
export interface PermissionSettings {
  allow?: string[];
  ask?: string[];
  deny?: string[];
  mode?: PermissionMode;
}

export interface PermissionFlags {
  /** `--allow-tool`, one tool per flag or a comma-separated list. */
  allowTools?: string[];
  /** `--deny-tool`. */
  denyTools?: string[];
  /** `--allowed-tools`, in the rule syntax. */
  allowedTools?: string[];
  /** `--disallowed-tools`, in the rule syntax. */
  disallowedTools?: string[];
  /** `--permission-mode`. */
  mode?: string;
}

export interface LoadedPermissions {
  rules: Rule[];
  mode: PermissionMode;
  /** Where the mode came from. */
  modeSource: string;
  /** Rules and settings that could not be read, each naming its file or flag. */
  errors: string[];
}

/** Rules every session starts with. Changing directory runs nothing by itself. */
export const BUILTIN_RULES = ['run_command(cd *)', 'run_command(pwd)'];

/** Split a flag's list on commas that are not inside a rule's parentheses or braces. */
export function splitRuleList(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(' || char === '{') depth += 1;
    if ((char === ')' || char === '}') && depth > 0) depth -= 1;
    if (char === ',' && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const readJson = (file: string): { value?: any; error?: string } => {
  if (!fs.existsSync(file)) return {};
  try {
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error: any) {
    return { error: `${file} is not valid JSON: ${error?.message ?? error}` };
  }
};

/**
 * The legacy per-tool block of `.jamcli/mcp.json`. Entries that only restate the defaults
 * JamCLI wrote there are not rules; the rest map as `allowed: false` to deny,
 * `require_approval: true` to ask, and anything else to allow.
 */
export function legacyRules(tools: Record<string, ToolPermissionValue | undefined> | undefined, source: string): Rule[] {
  const rules: Rule[] = [];
  for (const [name, value] of Object.entries(tools ?? {})) {
    const definition = TOOL_DEFINITIONS[name as ToolName];
    if (!definition || value === undefined) continue;
    const allowed = typeof value === 'boolean' ? value : value.allowed !== false;
    const asks = typeof value === 'boolean' ? Boolean(definition.defaultRequireApproval) : Boolean(value.require_approval);
    const decision: Decision = !allowed ? 'deny' : asks ? 'ask' : 'allow';
    const standard: Decision = definition.defaultRequireApproval ? 'ask' : 'allow';
    if (decision === standard) continue;
    rules.push({ decision, scope: 'project', text: name, source: `${source} tools.${name}`, tool: name });
  }
  return rules;
}

export function rulesFromSettings(settings: PermissionSettings | undefined, scope: RuleScope, source: string, errors: string[]): Rule[] {
  const rules: Rule[] = [];
  for (const decision of ['deny', 'ask', 'allow'] as const) {
    const list = settings?.[decision];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push(`${source} permissions.${decision} must be a list of rules.`);
      continue;
    }
    list.forEach((text, index) => {
      const parsed = parseRule(String(text), decision, scope, `${source} permissions.${decision}[${index}]`);
      if ('error' in parsed) errors.push(`${source}: ${parsed.error}`);
      else rules.push(parsed.rule);
    });
  }
  return rules;
}

const flagRules = (values: string[] | undefined, decision: Decision, flag: string, split: (value: string) => string[], errors: string[]) =>
  (values ?? []).flatMap(split).flatMap((text) => {
    const parsed = parseRule(text, decision, 'flag', `${flag} ${text}`);
    if ('error' in parsed) {
      errors.push(`${flag}: ${parsed.error}`);
      return [];
    }
    return [parsed.rule];
  });

/**
 * Every rule a session starts with, from built-in defaults, the user's configuration,
 * the project's, the project-local file, and the run's flags, each with its source.
 */
export function loadPermissions(options: {
  projectRoot: string;
  legacyTools?: Record<string, ToolPermissionValue | undefined>;
  flags?: PermissionFlags;
  env?: Record<string, string | undefined>;
}): LoadedPermissions {
  const errors: string[] = [];
  const env = options.env ?? process.env;
  const rules: Rule[] = BUILTIN_RULES.map((text) => (parseRule(text, 'allow', 'builtin', 'built-in') as { rule: Rule }).rule);
  const layers: { scope: RuleScope; file: string; label: string }[] = [
    { scope: 'user', file: path.join(userConfigDir(), 'config.json'), label: '~/.config/jamcli/config.json' },
    { scope: 'project', file: path.join(options.projectRoot, '.jamcli', 'config.json'), label: '.jamcli/config.json' },
    { scope: 'local', file: path.join(options.projectRoot, '.jamcli', 'config.local.json'), label: '.jamcli/config.local.json' },
  ];

  let mode: PermissionMode = 'default';
  let modeSource = 'the default';
  for (const layer of layers) {
    const { value, error } = readJson(layer.file);
    if (error) errors.push(error);
    const settings: PermissionSettings | undefined = value?.permissions;
    rules.push(...rulesFromSettings(settings, layer.scope, layer.label, errors));
    if (layer.scope === 'project') rules.push(...legacyRules(options.legacyTools, '.jamcli/mcp.json'));
    if (settings?.mode !== undefined) {
      if (isPermissionMode(settings.mode)) {
        mode = settings.mode;
        modeSource = `${layer.label} permissions.mode`;
      } else errors.push(`${layer.label} permissions.mode "${settings.mode}" is not a mode.`);
    }
  }

  const envMode = env.JAMCLI_PERMISSION_MODE;
  if (envMode) {
    if (isPermissionMode(envMode)) {
      mode = envMode;
      modeSource = 'JAMCLI_PERMISSION_MODE';
    } else errors.push(`JAMCLI_PERMISSION_MODE "${envMode}" is not a mode.`);
  }

  const flags = options.flags ?? {};
  const byComma = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
  rules.push(
    ...flagRules(flags.allowTools, 'allow', '--allow-tool', byComma, errors),
    ...flagRules(flags.denyTools, 'deny', '--deny-tool', byComma, errors),
    ...flagRules(flags.allowedTools, 'allow', '--allowed-tools', splitRuleList, errors),
    ...flagRules(flags.disallowedTools, 'deny', '--disallowed-tools', splitRuleList, errors)
  );
  if (flags.mode !== undefined) {
    if (isPermissionMode(flags.mode)) {
      mode = flags.mode;
      modeSource = '--permission-mode';
    } else errors.push(`--permission-mode "${flags.mode}" is not a mode; use plan, default, accept-edits, auto, or bypass.`);
  }
  return { rules, mode, modeSource, errors };
}
