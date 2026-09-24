import fs from 'fs';
import path from 'path';
import { ensureProjectStateDir } from '../transcript/log.js';
import { splitRuleList } from './config.js';
import { parseRule, type Rule } from './rules.js';

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
 * Remember rules for the project in `.jamcli/config.local.json`, under
 * `permissions.allow`, keeping everything else in the file. The directory is created
 * ignoring itself, so the grant never lands in the repository.
 */
export function writeProjectGrant(projectRoot: string, rules: string[]): string {
  ensureProjectStateDir(projectRoot);
  const file = path.join(projectRoot, LOCAL_CONFIG);
  let config: Record<string, any> = {};
  if (fs.existsSync(file)) {
    try {
      config = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error: any) {
      throw new Error(`${LOCAL_CONFIG} is not valid JSON, so the grant was not saved: ${error?.message ?? error}`);
    }
  }
  const permissions = (config.permissions ??= {});
  const allow: string[] = Array.isArray(permissions.allow) ? permissions.allow : [];
  permissions.allow = [...allow, ...rules.filter((rule) => !allow.includes(rule))];
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return file;
}
