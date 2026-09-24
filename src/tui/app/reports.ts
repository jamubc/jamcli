import { formatUsd, type SpendSummary } from '../../core/catalog/cost.js';
import type { FactSource, ModelInfo } from '../../core/catalog/types.js';
import type { Rule } from '../../core/permissions/rules.js';
import type { ContextUsage, ToolSummary } from '../../core/runtime/index.js';
import type { SessionSummary } from '../../core/transcript/sessions.js';
import type { ApiRegistry } from '../../types/config.js';
import { formatTokens } from './format.js';

/**
 * What the slash commands report, as plain text. Each is a pure function of what the
 * runtime knows, so the words can be tested without a terminal, and every line reads the
 * same without color or to a screen reader.
 */

const count = (value: number) => value.toLocaleString('en-US');
const plural = (value: number, one: string, many = `${one}s`) => `${count(value)} ${value === 1 ? one : many}`;

const SOURCE_WORDS: Record<FactSource, string> = {
  config: 'from the models block',
  provider: 'from the provider',
  bundled: 'from the bundled table',
  local: 'local models cost nothing',
  default: 'a default, since no source knows it',
};

/** The model turns run on, and what is known about it, each fact with where it came from. */
export function modelReport(info: ModelInfo): string {
  const from = (fact: keyof ModelInfo['sources']) => (info.sources[fact] ? ` (${SOURCE_WORDS[info.sources[fact]!]})` : '');
  const lines = [`Model: ${info.provider}:${info.model}`, `Context window: ${count(info.contextWindow)} tokens${from('contextWindow')}`];
  if (info.maxOutput) lines.push(`Longest reply: ${count(info.maxOutput)} tokens${from('maxOutput')}`);
  const can = [info.tools ? 'tools' : '', info.reasoning ? 'reasoning' : '', info.images ? 'images' : ''].filter(Boolean);
  if (can.length) lines.push(`Takes: ${can.join(', ')}`);
  if (info.thinking) lines.push(`Thinking: ${info.thinking}${info.alwaysThinks ? ', always on' : ''}${info.effort ? ', with an effort setting' : ''}`);
  lines.push(
    info.price
      ? `Price per million tokens: ${formatUsd(info.price.input)} in, ${formatUsd(info.price.output)} out${from('price')}`
      : 'Price: unknown, so its requests are counted as unpriced'
  );
  lines.push('', 'Switch with /model provider:model, such as /model ollama:qwen3-coder.');
  return lines.join('\n');
}

export function contextReport(usage: ContextUsage, messages: number): string {
  const percent = usage.budget > 0 ? Math.round((usage.used / usage.budget) * 100) : 0;
  const lines = [
    `Context: ${count(usage.used)} of ${count(usage.budget)} tokens a request may use (${percent}%), over ${plural(messages, 'message')}.`,
    `Window: ${count(usage.window)} tokens${usage.windowKnown ? '' : ', a guess: compaction waits until the provider refuses a request as too long'}.`,
    usage.autoCompact
      ? `Compaction starts at ${count(usage.trigger)} tokens. /compact runs it now, and /compact <focus> steers the summary.`
      : 'Automatic compaction is off (context.auto_compact). /compact runs it now.',
  ];
  if (usage.correction !== 1) lines.push(`Estimates are scaled by ${usage.correction.toFixed(2)} to match the provider's counts.`);
  return lines.join('\n');
}

export function costReport(spend: SpendSummary): string {
  if (spend.requests === 0) return 'No requests yet, so nothing has been spent.';
  const lowerBound = spend.unpriced > 0;
  const lines = [
    `This session: ${formatUsd(spend.cost)}${lowerBound ? ' or more' : ''} over ${plural(spend.requests, 'request')}.`,
  ];
  if (lowerBound) lines.push(`${plural(spend.unpriced, 'request')} had no known price and ${spend.unpriced === 1 ? 'is' : 'are'} not in the total.`);
  lines.push('', 'By model:');
  for (const model of spend.models) {
    const tokens = `${formatTokens(model.usage.prompt_tokens)} in, ${formatTokens(model.usage.completion_tokens)} out`;
    const price = model.unpriced === model.requests ? 'no known price' : `${formatUsd(model.cost)}${model.unpriced ? ` for ${plural(model.requests - model.unpriced, 'priced request')}` : ''}`;
    lines.push(`- ${model.model}: ${price}, ${plural(model.requests, 'request')}, ${tokens}`);
  }
  if (spend.delegated.requests) lines.push('', `Delegated work, already counted above: ${formatUsd(spend.delegated.cost)} over ${plural(spend.delegated.requests, 'request')}.`);
  return lines.join('\n');
}

const SCOPE_WORDS: Record<Rule['scope'], string> = {
  builtin: 'built in',
  user: 'user',
  project: 'project',
  local: 'project-local',
  session: 'this session',
  flag: 'a flag',
};

export const PERMISSIONS_USAGE = [
  'Add a rule: /permissions allow|ask|deny <rule> [session|local|project|user]',
  '  It is saved in .jamcli/config.local.json unless another scope is named.',
  'Remove a rule, wherever it is written: /permissions remove <rule>',
  'A rule is a tool, or a tool and a pattern: grep, run_command(npm test *), edit(src/**).',
].join('\n');

/** The mode and every rule, strongest decision first, each with its scope and where it is written. */
export function permissionsReport(mode: string, rules: Rule[]): string {
  const lines = [`Mode: ${mode}. A deny from any scope wins, then a person's rules, then configured ones, then the mode.`, ''];
  if (rules.length === 0) lines.push('No rules.');
  for (const decision of ['deny', 'ask', 'allow'] as const) {
    const listed = rules.filter((rule) => rule.decision === decision);
    if (listed.length === 0) continue;
    lines.push(`${decision}:`);
    for (const rule of listed) lines.push(`- ${rule.text}  (${SCOPE_WORDS[rule.scope]}: ${rule.source})`);
  }
  lines.push('', PERMISSIONS_USAGE);
  return lines.join('\n');
}

/** What the model is offered, grouped by where each tool comes from. */
export function toolsReport(tools: ToolSummary[]): string {
  const groups = new Map<string, ToolSummary[]>();
  for (const tool of tools) {
    const key = tool.source === 'mcp' ? `MCP server ${tool.server ?? 'unknown'}` : 'Built in';
    groups.set(key, [...(groups.get(key) ?? []), tool]);
  }
  const lines = [`${plural(tools.length, 'tool')} offered to the model. A tool a rule or the mode denies outright is not offered.`];
  for (const [group, list] of groups) {
    lines.push('', `${group}:`);
    for (const tool of list) lines.push(`- ${tool.name} (${tool.policyClass}): ${tool.description.split('\n')[0].slice(0, 100)}`);
  }
  lines.push('', '/permissions shows and changes what each may do.');
  return lines.join('\n');
}

const when = (iso: string, now: number) => {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes)) return 'at an unknown time';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`;
  if (minutes < 60 * 24) return `${plural(Math.round(minutes / 60), 'hour')} ago`;
  return `${plural(Math.round(minutes / (60 * 24)), 'day')} ago`;
};

/** A project's sessions, latest first, for /resume. */
export function sessionsReport(sessions: SessionSummary[], current: string, now = Date.now()): string {
  if (sessions.length === 0) return 'No earlier sessions in this project.';
  const lines = ['Sessions in this project, latest first:'];
  for (const session of sessions) {
    const title = session.title || session.firstUserMessage?.slice(0, 60) || 'untitled';
    lines.push(`- ${session.id}${session.id === current ? ' (this one)' : ''}: ${title}, ${plural(session.messageCount, 'message')}, ${when(session.updated, now)}`);
  }
  lines.push('', 'Open one with /resume <id>.');
  return lines.join('\n');
}


/**
 * The configured providers and endpoints, and where each finds its key. A key written in
 * a file is never shown, only that it is there.
 */
export function providersReport(registry: ApiRegistry, env: Record<string, string | undefined>, stored: (account: string) => boolean): string {
  const keyWord = (entry: { api_key?: string; key_env_var?: string } | undefined, account: string) => {
    if (entry?.key_env_var) return `key from $${entry.key_env_var} (${env[entry.key_env_var] ? 'set' : 'not set'})`;
    if (entry?.api_key) return 'key written in a configuration file (hidden; key_env_var keeps it out of files)';
    if (stored(account)) return 'key in the key store';
    return 'no key';
  };
  const lines = ['Providers:'];
  const ollama = registry.ollama ?? {};
  lines.push(`- ollama: ${ollama.base_url ?? ollama.endpoint ?? 'http://localhost:11434'}${ollama.num_ctx ? `, a ${count(ollama.num_ctx)}-token window` : ''}, no key needed`);
  for (const name of ['openai', 'anthropic', 'openrouter'] as const) {
    const entry = registry[name] as { api_key?: string; key_env_var?: string; base_url?: string } | undefined;
    const key = keyWord(entry, name);
    if (!entry && key === 'no key') continue;
    lines.push(`- ${name}: ${entry?.base_url ?? 'the standard address'}, ${key}`);
  }
  for (const endpoint of registry.endpoints ?? []) {
    lines.push(`- ${endpoint.id}: ${endpoint.base_url}, ${endpoint.dialect ?? 'openai'} format, ${keyWord(endpoint, endpoint.id)}`);
  }
  lines.push('', 'Change one with /config set api_registry.<provider>.<key> <value>, or store a key with jamcli auth login <provider>.');
  return lines.join('\n');
}
