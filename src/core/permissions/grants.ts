import fs from 'fs';
import path from 'path';
import { ensureProjectStateDir } from '../transcript/log.js';
import { splitRuleList } from './config.js';
import { parseRule, type Decision, type Rule } from './rules.js';

export const LOCAL_CONFIG = '.jamcli/config.local.json';

/** The rules one grant stands for: a suggestion may list a rule for each part of a command. */
export function grantedRules(text: string, scope: 'session' | 'local', source: string): { rules: Rule[]; errors: string[] } {
  const rules: Rule[] = [];
  const errors: string[] = [];
  for (const item of splitRuleList(text)) {
    const parsed = parseRule(item, 'allow', scope, source);
    if ('error' in parsed) errors.push(parsed.error);
    else rules.push(parsed.rule);
  }
  return { rules, errors };
}

/**
 * Add rules to, or remove them from, one decision's list in a configuration file,
 * keeping everything else in the file. A file that is not JSON is left alone, and the
 * error names it and says what did not happen. Returns whether the list changed.
 */
export function editRuleList(
  file: string,
  label: string,
  decision: Decision,
  rules: string[],
  change: 'add' | 'remove',
  unsaved = 'it was not changed'
): boolean {
  let config: Record<string, any> = {};
  if (fs.existsSync(file)) {
    try {
      config = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error: any) {
      throw new Error(`${label} is not valid JSON, so ${unsaved}: ${error?.message ?? error}`);
    }
  }
  const permissions = (config.permissions ??= {});
  const list: string[] = Array.isArray(permissions[decision]) ? permissions[decision] : [];
  const next = change === 'add' ? [...list, ...rules.filter((rule) => !list.includes(rule))] : list.filter((rule) => !rules.includes(rule));
  if (next.length === list.length) return false;
  permissions[decision] = next;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return true;
}

/**
 * Remember rules for the project in `.jamcli/config.local.json`, under
 * `permissions.allow`, keeping everything else in the file. The directory is created
 * ignoring itself, so the grant never lands in the repository.
 */
export function writeProjectGrant(projectRoot: string, rules: string[]): string {
  ensureProjectStateDir(projectRoot);
  const file = path.join(projectRoot, LOCAL_CONFIG);
  editRuleList(file, LOCAL_CONFIG, 'allow', rules, 'add', 'the grant was not saved');
  return file;
}
