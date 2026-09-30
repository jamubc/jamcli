import type { ToolPermissionValue } from '../../types/config.js';
import type { ToolRegistry } from '../tools/registry.js';
import { PermissionEngine } from '../permissions/engine.js';
import { loadPermissions, type PermissionFlags, type PermissionLayer } from '../permissions/config.js';
import { LOCAL_CONFIG, editRuleList, grantedRules, writeProjectGrant } from '../permissions/grants.js';
import { modeRefusal, type PermissionMode } from '../permissions/modes.js';
import { parseRule, type Decision, type Rule, type RuleScope } from '../permissions/rules.js';
import { displayPath, localConfigFile, projectConfigFile, userConfigFile } from '../config/load.js';
import { ensureProjectStateDir } from '../transcript/index.js';
import { toolNaming } from './tools.js';

/** Where a person may add a rule: for this session, or in one of the configuration files. */
export type EditableRuleScope = 'session' | 'local' | 'project' | 'user';
const EDITABLE: RuleScope[] = ['session', 'local', 'project', 'user'];
/** The per-tool block of the legacy MCP file, whose rules are edited in that file. */
const LEGACY_TOOLS_FILE = '.jamcli/mcp.json';

export interface SessionPermissionOptions {
  projectRoot: string;
  /** Where paths in calls are judged from, when the session works in a worktree. */
  workRoot?: string;
  registry: ToolRegistry;
  /** The configuration's layers, as resolved; read from their files when not given. */
  layers?: PermissionLayer[];
  /** The legacy per-tool block of `.jamcli/mcp.json`. */
  legacyTools?: Record<string, ToolPermissionValue | undefined>;
  flags?: PermissionFlags;
  /** `--dangerously-bypass-permissions`: start in bypass mode, confirmed. */
  bypass?: boolean;
  sandboxed: boolean;
  env?: Record<string, string | undefined>;
  /** `git.allow_commit_in_bypass`: bypass mode commits without asking. */
  commitInBypass?: boolean;
  /** The configured search provider's host, for web_search domain rules. */
  webSearchHost?: string;
}

/**
 * The permission engine a session starts with. A mode whose precondition fails, such as
 * `auto` without a sandbox or `bypass` from a file rather than the flag, falls back to
 * `default` with a notice saying which setting asked for it and why it cannot apply.
 */
export function sessionPermissions(options: SessionPermissionOptions): { engine: PermissionEngine; notices: string[] } {
  const loaded = loadPermissions({
    projectRoot: options.projectRoot,
    layers: options.layers,
    legacyTools: options.legacyTools,
    flags: options.flags,
    env: options.env,
  });
  const notices = [...loaded.errors];
  let mode: PermissionMode = options.bypass ? 'bypass' : loaded.mode;
  const refusal = modeRefusal(mode, { sandboxed: options.sandboxed, bypassConfirmed: options.bypass });
  if (refusal) {
    notices.push(`${loaded.modeSource} asks for ${mode} mode, but ${refusal} This session starts in default mode.`);
    mode = 'default';
  }
  const { classOf, namesOf, alwaysAsks } = toolNaming(options.registry);
  const engine = new PermissionEngine({
    projectRoot: options.workRoot ?? options.projectRoot,
    rules: loaded.rules,
    mode,
    sandboxed: options.sandboxed,
    classOf,
    namesOf,
    alwaysAsks,
    bypassAllowsAlwaysAsked: options.commitInBypass === true,
    webSearchHost: options.webSearchHost,
  });
  for (const rule of engine.unmatched(options.registry.list().map((tool) => tool.name))) {
    notices.push(`The rule ${rule.text} (${rule.source}) names no tool, so it has no effect.`);
  }
  return { engine, notices };
}

/**
 * The rules a person edits while a session runs: added for the session or saved in a
 * configuration file, removed from wherever a person can edit them, and granted for the
 * project at a prompt. Each change applies to the engine at once, so the next call sees it.
 */
export class RuleEditor {
  constructor(
    private readonly engine: PermissionEngine,
    private readonly projectRoot: string
  ) {}

  /** Add a rule, saving it in the scope's file. Returns why not, changing nothing, when it does not parse or cannot be written. */
  add(decision: Decision, text: string, scope: EditableRuleScope): string | undefined {
    const target = scope === 'session' ? undefined : this.file(scope);
    const parsed = parseRule(text, decision, scope, target ? `${target.label} permissions.${decision}` : 'added in this session');
    if ('error' in parsed) return parsed.error;
    if (target) {
      try {
        if (scope !== 'user') ensureProjectStateDir(this.projectRoot);
        editRuleList(target.file, target.label, decision, [parsed.rule.text], 'add');
      } catch (error: any) {
        return error?.message ?? String(error);
      }
    }
    this.engine.add(parsed.rule);
    return undefined;
  }

  /**
   * Remove every rule written as `text` from the scopes a person edits. Built-in rules, the
   * run's flags, and the legacy `.jamcli/mcp.json` block are kept, and returned as such.
   */
  remove(text: string): { removed: Rule[]; kept: Rule[]; error?: string } {
    const wanted = text.trim();
    const editable = (rule: Rule) => EDITABLE.includes(rule.scope) && !rule.source.startsWith(LEGACY_TOOLS_FILE);
    const matching = this.engine.list().filter((rule) => rule.text === wanted);
    const kept = matching.filter((rule) => !editable(rule));
    try {
      for (const rule of matching.filter(editable)) {
        if (rule.scope === 'session') continue;
        const target = this.file(rule.scope as Exclude<EditableRuleScope, 'session'>);
        editRuleList(target.file, target.label, rule.decision, [rule.text], 'remove');
      }
    } catch (error: any) {
      return { removed: [], kept, error: error?.message ?? String(error) };
    }
    return { removed: this.engine.remove((rule) => rule.text === wanted && editable(rule)), kept };
  }

  /**
   * A grant for the project, made at a prompt: it applies at once and is written for later
   * sessions. Returns what went wrong: a grant that does not parse is not made, and one that
   * cannot be written holds for this session only.
   */
  grantProject(text: string, how = 'granted at a prompt'): string | undefined {
    const { rules, errors } = grantedRules(text, 'local', `${LOCAL_CONFIG} permissions.allow (${how})`);
    if (errors.length) return `The grant was not saved: ${errors.join(' ')}`;
    try {
      writeProjectGrant(this.projectRoot, rules.map((rule) => rule.text));
      for (const rule of rules) this.engine.add(rule);
      return undefined;
    } catch (error: any) {
      for (const rule of rules) this.engine.add({ ...rule, scope: 'session' });
      return error?.message ?? String(error);
    }
  }

  /** The file a rule of a scope is saved in, and how messages name it. */
  private file(scope: Exclude<EditableRuleScope, 'session'>): { file: string; label: string } {
    const file = scope === 'user' ? userConfigFile() : scope === 'project' ? projectConfigFile(this.projectRoot) : localConfigFile(this.projectRoot);
    return { file, label: displayPath(file, this.projectRoot) };
  }
}
