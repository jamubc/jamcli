import path from 'path';
import os from 'os';
import type { ApprovalBy, PolicyClass, ToolCall } from '../types.js';
import { MODE_DEFAULTS, modeRefusal, type ModeDefault, type PermissionMode } from './modes.js';
import { patternMatches, toolMatches, type Decision, type Rule, type RuleScope, type Subject } from './rules.js';
import { subjectsOf } from './subjects.js';
import { grantedRules } from './grants.js';

export interface Verdict {
  decision: Decision;
  /** Who decided: a flag or configured rule, a person's grant, or the mode. */
  by: ApprovalBy;
  /** The rule that decided, as written. */
  rule?: string;
  scope?: RuleScope;
  /** Where that rule came from. */
  source?: string;
  reason: string;
}

export interface PermissionEngineOptions {
  projectRoot: string;
  rules?: Rule[];
  mode?: PermissionMode;
  /** Whether commands run inside a sandbox, which `auto` requires. */
  sandboxed?: boolean;
  classOf: (tool: string) => PolicyClass | 'unknown';
  /** Every name a tool answers to: its canonical name first, then its aliases. */
  namesOf: (tool: string) => string[];
  /** Tools that ask every time, such as a commit, whatever the rules and the mode say. */
  alwaysAsks?: (tool: string) => boolean;
  /** Whether bypass mode may run those without asking, as `git.allow_commit_in_bypass` says. */
  bypassAllowsAlwaysAsked?: boolean;
}

/** A person's choices for this run outrank configuration, except a deny, which nothing outranks. */
const PERSONAL: RuleScope[] = ['flag', 'session'];

const byOf = (scope: RuleScope): ApprovalBy => (scope === 'flag' ? 'flag' : scope === 'session' ? 'user' : 'policy');

const fromRule = (rule: Rule, reason: string): Verdict => ({
  decision: rule.decision,
  by: byOf(rule.scope),
  rule: rule.text,
  scope: rule.scope,
  source: rule.source,
  reason,
});

/** The strongest rule for one subject: any deny, then a person's ask or allow, then configuration's. */
const strongest = (rules: Rule[]): Rule | undefined => {
  const deny = rules.find((rule) => rule.decision === 'deny');
  if (deny) return deny;
  const pick = (list: Rule[]) => list.find((rule) => rule.decision === 'ask') ?? list.find((rule) => rule.decision === 'allow');
  return pick(rules.filter((rule) => PERSONAL.includes(rule.scope))) ?? pick(rules.filter((rule) => !PERSONAL.includes(rule.scope)));
};

const SAFE_REDIRECTS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty']);

/** What each class of tool does, for the reasons a mode gives. */
const WHAT_TOOLS_DO: Record<string, string> = {
  read: 'read the project',
  write: 'change files',
  execute: 'run commands',
  network: 'reach the network',
  delegate: 'start other agents',
  state: 'keep the plan',
  unknown: 'JamCLI cannot classify',
};

/**
 * Decides every tool call from rules and the mode. A deny from any scope wins; plan mode
 * denies changes; bypass allows the rest; code a rule cannot see always asks; then a
 * person's rules, then configured rules, then the mode's default for the tool's class.
 * Every verdict names the rule, scope, and source that produced it.
 */
export class PermissionEngine {
  private rules: Rule[];
  private currentMode: PermissionMode;
  readonly sandboxed: boolean;
  /** While a command or skill with `allowed-tools` is active: only what these rules name may run. */
  private narrowing: { rules: Rule[]; label: string } | undefined;

  constructor(private readonly options: PermissionEngineOptions) {
    this.rules = [...(options.rules ?? [])];
    this.currentMode = options.mode ?? 'default';
    this.sandboxed = Boolean(options.sandboxed);
  }

  get mode(): PermissionMode {
    return this.currentMode;
  }

  /** Switch modes. Returns why not, and changes nothing, when the mode's precondition fails. */
  setMode(mode: PermissionMode, options: { bypassConfirmed?: boolean } = {}): string | undefined {
    const refusal = modeRefusal(mode, { sandboxed: this.sandboxed, bypassConfirmed: options.bypassConfirmed });
    if (!refusal) this.currentMode = mode;
    return refusal;
  }

  list(): Rule[] {
    return [...this.rules];
  }

  /**
   * Narrow what may run to what `rules` name, while `label` (a command or a skill) is
   * active; nothing again lifts it. Narrowing never allows: a call it lets through is
   * decided as any other. Narrowing again keeps only what both allow.
   */
  narrow(rules: Rule[] | undefined, label = 'this command'): void {
    if (!rules) {
      this.narrowing = undefined;
      return;
    }
    if (!this.narrowing) {
      this.narrowing = { rules, label };
      return;
    }
    const earlier = this.narrowing.rules;
    // Keep the entries of the new list that the earlier one already covers.
    const kept = rules.filter((rule) => earlier.some((before) => toolMatches(before, [rule.tool]) && (!before.pattern || before.pattern === rule.pattern)));
    this.narrowing = { rules: kept, label: `${this.narrowing.label} and ${label}` };
  }

  /** What narrows the tools now, if anything. */
  get narrowed(): { rules: Rule[]; label: string } | undefined {
    return this.narrowing;
  }

  /** Add a rule for the rest of the session, such as a grant made at an approval prompt. */
  add(rule: Rule): void {
    this.rules.push(rule);
  }

  /** Take out the rules that match, and return them. */
  remove(match: (rule: Rule) => boolean): Rule[] {
    const removed = this.rules.filter(match);
    this.rules = this.rules.filter((rule) => !match(rule));
    return removed;
  }

  /**
   * Grant a pattern, or a list of them, for this session. Returns an error, and grants
   * nothing, when any item is not a rule.
   */
  grant(text: string, source = 'granted at an approval prompt'): string | undefined {
    const { rules, errors } = grantedRules(text, 'session', source);
    if (errors.length) return errors.join(' ');
    for (const rule of rules) this.add(rule);
    return undefined;
  }

  /** Rules that name no tool this session has, for reporting. */
  unmatched(toolNames: string[]): Rule[] {
    return this.rules.filter((rule) => rule.scope !== 'builtin' && !toolNames.some((name) => toolMatches(rule, this.options.namesOf(name))));
  }

  /** Whether a tool is offered at all: not when a rule or the mode denies it outright. */
  offers(tool: string): boolean {
    const names = this.options.namesOf(tool);
    if (this.narrowing && !this.narrowing.rules.some((rule) => toolMatches(rule, names))) return false;
    if (this.rules.some((rule) => rule.decision === 'deny' && !rule.pattern && toolMatches(rule, names))) return false;
    return MODE_DEFAULTS[this.currentMode][this.options.classOf(tool)] !== 'deny';
  }

  decide(call: ToolCall): Verdict {
    const names = this.options.namesOf(call.name);
    const toolClass = this.options.classOf(call.name);
    const applicable = this.rules.filter((rule) => toolMatches(rule, names));
    const { subjects, command } = subjectsOf(call, names[0], this.options.projectRoot);
    const targets: (Subject | undefined)[] = subjects.length ? subjects : [undefined];
    const decided = targets.map((subject) => strongest(applicable.filter((rule) => patternMatches(rule, subject))));

    if (this.narrowing) {
      const narrowing = this.narrowing;
      const covered = targets.every((subject) => narrowing.rules.some((rule) => toolMatches(rule, names) && patternMatches(rule, subject)));
      if (!covered) {
        const named = narrowing.rules.map((rule) => rule.text).join(', ') || 'no tools';
        return { decision: 'deny', by: 'policy', reason: `${narrowing.label} allows only ${named}` };
      }
    }

    const denied = decided.find((rule) => rule?.decision === 'deny');
    if (denied) return fromRule(denied, `${denied.text} denies it (${denied.source})`);

    const byMode = MODE_DEFAULTS[this.currentMode][toolClass];
    if (this.currentMode === 'plan' && byMode === 'deny') {
      return { decision: 'deny', by: 'mode', reason: 'plan mode is on, so this session only reads and plans' };
    }
    if (this.options.alwaysAsks?.(names[0])) {
      if (this.currentMode === 'bypass' && this.options.bypassAllowsAlwaysAsked) return { decision: 'allow', by: 'mode', reason: 'bypass mode allows it, as git.allow_commit_in_bypass says' };
      return { decision: 'ask', by: 'policy', reason: 'a commit is always asked for; no rule or mode allows one ahead' };
    }
    if (this.currentMode === 'bypass') return { decision: 'allow', by: 'mode', reason: 'bypass mode allows everything no rule denies' };

    if (command?.hidden.length) {
      return { decision: 'ask', by: 'policy', reason: `${command.hidden[0]} can run code no rule can see, so it always asks` };
    }
    const outside = command?.redirects.find((redirect) => redirect.dynamic || !this.insideProject(redirect.target, call));
    if (outside) {
      return {
        decision: 'ask',
        by: 'policy',
        reason: outside.dynamic ? `the redirection to ${outside.target || 'an expansion'} cannot be checked, so it asks` : `it writes or reads ${outside.target}, outside the project`,
      };
    }

    const asked = decided.find((rule) => rule?.decision === 'ask');
    if (asked) return fromRule(asked, `${asked.text} asks first (${asked.source})`);
    if (decided.every((rule) => rule?.decision === 'allow')) {
      const allowed = decided[0]!;
      return fromRule(allowed, `${allowed.text} allows it (${allowed.source})`);
    }
    return this.modeDefault(byMode, toolClass, subjects);
  }

  private modeDefault(byMode: ModeDefault, toolClass: string, subjects: Subject[]): Verdict {
    const mode = this.currentMode;
    const what = WHAT_TOOLS_DO[toolClass] ?? WHAT_TOOLS_DO.unknown;
    switch (byMode) {
      case 'allow':
        return { decision: 'allow', by: 'mode', reason: `${mode} mode allows tools that ${what}` };
      case 'deny':
        return { decision: 'deny', by: 'mode', reason: `${mode} mode does not allow tools that ${what}` };
      case 'inside': {
        const inside = subjects.every((subject) => subject.kind !== 'path' || subject.relative !== undefined);
        return inside
          ? { decision: 'allow', by: 'mode', reason: `${mode} mode allows changes inside the project` }
          : { decision: 'ask', by: 'mode', reason: `${mode} mode asks before changes outside the project` };
      }
      case 'sandboxed':
        return this.sandboxed
          ? { decision: 'allow', by: 'mode', reason: `${mode} mode allows commands inside the sandbox` }
          : { decision: 'ask', by: 'mode', reason: `${mode} mode asks before commands when there is no sandbox` };
      default:
        return { decision: 'ask', by: 'mode', reason: `${mode} mode asks before tools that ${what}` };
    }
  }

  private insideProject(target: string, call: ToolCall): boolean {
    if (SAFE_REDIRECTS.has(target)) return true;
    const root = path.resolve(this.options.projectRoot);
    const cwd = typeof call.arguments?.cwd === 'string' ? path.resolve(root, call.arguments.cwd) : root;
    const expanded = target === '~' ? os.homedir() : target.startsWith('~/') ? path.join(os.homedir(), target.slice(2)) : target;
    const relative = path.relative(root, path.resolve(cwd, expanded));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }
}
