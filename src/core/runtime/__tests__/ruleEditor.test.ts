import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { RuleEditor } from '../permissions.js';
import { PermissionEngine } from '../../permissions/engine.js';
import { parseRule, type Rule } from '../../permissions/rules.js';
import { createBuiltinRegistry } from '../../tools/registry.js';
import { toolNaming } from '../tools.js';

let dir: string;
let previousConfig: string | undefined;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-rule-editor-')));
  previousConfig = process.env.JAMCLI_CONFIG_DIR;
  process.env.JAMCLI_CONFIG_DIR = path.join(dir, '.user');
});
afterEach(() => {
  if (previousConfig === undefined) delete process.env.JAMCLI_CONFIG_DIR;
  else process.env.JAMCLI_CONFIG_DIR = previousConfig;
  fs.rmSync(dir, { recursive: true, force: true });
});

const legacy = (parseRule('run_command(ls)', 'allow', 'project', '.jamcli/mcp.json tools.run_command') as { rule: Rule }).rule;
const editor = () => {
  const engine = new PermissionEngine({ projectRoot: dir, rules: [legacy], ...toolNaming(createBuiltinRegistry()) });
  return { engine, rules: new RuleEditor(engine, dir) };
};
const json = (file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

test('a rule is added for the session or saved in its file, and removed from every file a person edits', () => {
  const { engine, rules } = editor();
  expect(rules.add('allow', 'edit', 'session')).toBeUndefined();
  expect(rules.add('deny', 'run_command(rm *)', 'project')).toBeUndefined();
  expect(rules.add('allow', 'run_command(ls)', 'user')).toBeUndefined();
  expect(json('.jamcli/config.json').permissions.deny).toEqual(['run_command(rm *)']);
  expect(json('.user/config.json').permissions.allow).toEqual(['run_command(ls)']);
  expect(engine.decide({ id: 'c', name: 'run_command', arguments: { command: 'rm -rf x' } })).toMatchObject({ decision: 'deny', rule: 'run_command(rm *)' });

  // The legacy block's copy of a rule is kept, and said to be.
  const { removed, kept } = rules.remove('run_command(ls)');
  expect(removed.map((rule) => rule.scope)).toEqual(['user']);
  expect(kept).toEqual([legacy]);
  expect(json('.user/config.json').permissions.allow).toEqual([]);
  expect(rules.remove('edit').removed.map((rule) => rule.scope)).toEqual(['session']);
  expect(rules.add('allow', 'edit(', 'session')).toContain('edit(');
});

test('a grant for the project is written for later sessions, and holds for this one when it cannot be', () => {
  const { engine, rules } = editor();
  expect(rules.grantProject('run_command(git status)')).toBeUndefined();
  expect(json('.jamcli/config.local.json').permissions.allow).toEqual(['run_command(git status)']);
  expect(engine.list().at(-1)).toMatchObject({ text: 'run_command(git status)', scope: 'local' });

  fs.writeFileSync(path.join(dir, '.jamcli/config.local.json'), '{ not json');
  expect(rules.grantProject('run_command(git log)')).toContain('is not valid JSON, so the grant was not saved');
  expect(engine.list().at(-1)).toMatchObject({ text: 'run_command(git log)', scope: 'session' });
  expect(rules.grantProject('edit(')).toStartWith('The grant was not saved:');
});
