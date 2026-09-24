import os from 'os';
import path from 'path';
import { globMatcher, pathsIgnoreCase } from './glob.js';

export type Decision = 'allow' | 'ask' | 'deny';

/** Where a rule came from, lowest to highest. `flag` and `session` are a person's choices for this run. */
export type RuleScope = 'builtin' | 'user' | 'project' | 'local' | 'session' | 'flag';

export interface Rule {
  decision: Decision;
  scope: RuleScope;
  /** The rule as written, such as `edit(src/**)`. */
  text: string;
  /** The file and key, or the flag, it came from. */
  source: string;
  /** A tool name, or a glob over tool names such as `github__*`. */
  tool: string;
  /** What the rule is about inside the tool, if anything. */
  pattern?: string;
}

/** What a call is about: the paths it touches, each simple command it runs, or the domain it reaches. */
export type Subject =
  | { kind: 'path'; relative?: string; absolute: string }
  | { kind: 'command'; value: string }
  | { kind: 'domain'; value: string };

const RULE = /^([A-Za-z0-9_.*-]+)(?:\((.*)\))?$/s;

export function parseRule(
  text: string,
  decision: Decision,
  scope: RuleScope,
  source: string
): { rule: Rule } | { error: string } {
  const trimmed = text.trim();
  const match = RULE.exec(trimmed);
  if (!match) return { error: `"${text}" is not a rule; write Tool or Tool(pattern).` };
  const pattern = match[2]?.trim();
  if (match[2] !== undefined && !pattern) return { error: `"${text}" has an empty pattern.` };
  return { rule: { decision, scope, text: trimmed, source, tool: match[1], ...(pattern ? { pattern } : {}) } };
}

const home = () => os.homedir();
const expandHome = (value: string) => (value === '~' ? home() : value.startsWith('~/') ? path.join(home(), value.slice(2)) : value);
const posix = (value: string) => value.split(path.sep).join('/');

/**
 * A command pattern: `*` matches anything, and a trailing ` *` also matches the command
 * with nothing after it, so `npm test *` covers `npm test` and `npm test --watch`.
 */
const commandMatcher = (pattern: string): ((command: string) => boolean) => {
  const collapse = (text: string) => text.trim().replace(/\s+/g, ' ');
  const normalized = collapse(pattern);
  const toRegex = (text: string) => text.split('*').map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  const source = normalized.endsWith(' *') ? `${toRegex(normalized.slice(0, -2))}(?: .*)?` : toRegex(normalized);
  const regex = new RegExp(`^${source}$`, 's');
  return (command) => regex.test(collapse(command));
};

const domainMatcher = (pattern: string): ((host: string) => boolean) => {
  const wanted = pattern.slice('domain:'.length).toLowerCase();
  if (wanted.startsWith('*.')) {
    const suffix = wanted.slice(1);
    return (host) => host.toLowerCase().endsWith(suffix) || host.toLowerCase() === wanted.slice(2);
  }
  return (host) => host.toLowerCase() === wanted;
};

/** Whether a rule's pattern covers one subject. A rule without a pattern covers the whole tool. */
export function patternMatches(rule: Rule, subject: Subject | undefined, platform = process.platform): boolean {
  if (!rule.pattern) return true;
  if (!subject) return false;
  if (subject.kind === 'command') return commandMatcher(rule.pattern)(subject.value);
  if (subject.kind === 'domain') return rule.pattern.startsWith('domain:') && domainMatcher(rule.pattern)(subject.value);
  const caseInsensitive = pathsIgnoreCase(platform);
  const pattern = expandHome(rule.pattern.replace(/^\.\//, ''));
  if (path.isAbsolute(pattern)) return globMatcher(posix(pattern), { caseInsensitive })(posix(subject.absolute));
  return subject.relative !== undefined && globMatcher(pattern, { caseInsensitive })(subject.relative);
}

/** Whether a rule names the tool, under any of the names the tool answers to. */
export function toolMatches(rule: Rule, names: string[]): boolean {
  const matches = globMatcher(rule.tool);
  return names.some((name) => matches(name));
}
