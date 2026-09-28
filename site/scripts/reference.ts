/**
 * Writes the reference pages' tables from the definitions the product itself reads, so a
 * table cannot say anything its definition does not. Fails, naming each, when a command,
 * a visible tool or one of its parameters, or a setting has no text of its own: the text
 * is written once, at the definition, and shown to the person and the reader alike.
 * Run before each build and dev run; the output is never committed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BUILTIN_COMMANDS } from '../../src/commands/builtin/index.ts';
import { settingsFromSchema } from '../../src/commands/settings.ts';
import { BUILTIN_TOOLS } from '../../src/core/tools/builtins.ts';
import { ACTION_WORDS, DEFAULT_KEYS, KEY_ACTIONS } from '../../src/tui/app/keys.ts';
import { USAGE } from '../../src/cli.ts';

export interface Table {
  columns: string[];
  rows: string[][];
}

const out = path.resolve(import.meta.dir, '../src/generated/reference.json');
const missing: string[] = [];
const text = (value: string | undefined, what: string): string => {
  if (!value?.trim()) missing.push(what);
  return value?.trim() ?? '';
};

const commands: Table = {
  columns: ['Command', 'Aliases', 'What it does'],
  rows: BUILTIN_COMMANDS.map((command) => [
    `/${command.name}${command.args ? ` ${command.args}` : ''}`,
    (command.aliases ?? []).map((alias) => `/${alias}`).join(', '),
    text(command.summary, `command /${command.name} has no summary`),
  ]),
};

const visible = BUILTIN_TOOLS.filter((tool) => !tool.hidden);

const tools: Table = {
  columns: ['Tool', 'Class', 'Always asks', 'What it does'],
  rows: visible.map((tool) => [tool.name, tool.policy, tool.alwaysAsks ? 'yes' : '', text(tool.description, `tool ${tool.name} has no description`)]),
};

const typeOf = (schema: any): string => {
  if (Array.isArray(schema?.enum)) return schema.enum.map(String).join(' | ');
  if (schema?.type === 'array') return `${typeOf(schema.items)}[]`;
  return Array.isArray(schema?.type) ? schema.type.join(' | ') : (schema?.type ?? 'any');
};

const toolParameters: Table = {
  columns: ['Tool', 'Parameter', 'Type', 'Required', 'What it is'],
  rows: visible.flatMap((tool) => {
    const required = new Set<string>(tool.inputSchema?.required ?? []);
    return Object.entries<any>(tool.inputSchema?.properties ?? {}).map(([name, schema]) => [
      tool.name,
      name,
      typeOf(schema),
      required.has(name) ? 'yes' : '',
      text(schema?.description, `parameter ${name} of tool ${tool.name} has no description`),
    ]);
  }),
};

const aliases: Table = {
  columns: ['Older name', 'Runs'],
  rows: BUILTIN_TOOLS.filter((tool) => tool.aliasOf).map((tool) => [tool.name, tool.aliasOf!]),
};

const settings: Table = {
  columns: ['Setting', 'Takes', 'What it does'],
  rows: settingsFromSchema().map((setting) => [
    setting.key,
    setting.choices?.join(' | ') ?? setting.kind,
    text(setting.description, `setting ${setting.key} has no description`),
  ]),
};

const keys: Table = {
  columns: ['Action', 'Keys', 'What it does'],
  rows: KEY_ACTIONS.map((action) => [action, DEFAULT_KEYS[action].join(', '), text(ACTION_WORDS[action], `key action ${action} has no words`)]),
};

if (missing.length) {
  console.error(missing.length === 1 ? '1 definition has no text of its own:' : `${missing.length} definitions have no text of their own:`);
  for (const problem of missing) console.error(`  ${problem}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify({ commands, tools, toolParameters, aliases, settings, keys, usage: USAGE }, null, 2)}\n`);
console.log(
  `Reference: ${commands.rows.length} commands, ${tools.rows.length} tools, ${settings.rows.length} settings, ${keys.rows.length} keys, from the definitions.`
);
