import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Runtime } from '../../core/runtime/index.js';
import type { EditableRuleScope } from '../../core/runtime/index.js';
import { isPermissionMode } from '../../core/permissions/modes.js';
import type { Decision } from '../../core/permissions/rules.js';
import { displayPath, loadConfig, userConfigFile } from '../../core/config/load.js';
import { storedKey } from '../../core/config/credentials.js';
import { userConfigDir } from '../../utils/paths.js';
import { choiceOf, effortFor, EFFORT_LEVELS, isEffortLevel, isThinkingChoice, THINKING_CHOICES, thinkingFor, type ThinkingChoice } from '../../core/routing/capabilities.js';
import { describeRun, describeSource, loadAgents, type LoadedAgents } from '../../core/ext/agents.js';
import { debugTranscript, readSessionIndex, readTranscript, sessionFileFor, transcriptToMarkdown } from '../../core/transcript/index.js';
import { CONFIG_ACTIONS, CONFIG_USAGE, runConfigCommand, type ConfigAction } from '../../cli/config.js';
import type { McpCommandRequest } from '../../cli/mcp.js';
import { contextReport, costReport, modelDetail, modelReport, permissionsReport, PERMISSIONS_USAGE, providersReport, sessionDetail, sessionsReport, toolsReport } from '../reports.js';
import { originOf, SCOPE_WORDS, settingsFromSchema, type Setting } from '../settings.js';
import { findCommand, splitWords } from '../parse.js';
import type { ChoiceItem, CommandContext, SessionChoice, SlashCommand } from '../types.js';
import { THEME_NAMES, noColor } from '../../styles/themeNames.js';
import type { ThemeName } from '../../types/config.js';
import { setup } from './setup.js';
import { style } from './style.js';
import { rewind, undo } from './rewind.js';
import { diff } from './review.js';
import { commit } from './commit.js';
import { pr } from './pr.js';
import { commandsList, hooksCommand, plugins, skills } from './extensions.js';
import { workflowsCommand } from './workflows.js';
import { reflect } from './reflect.js';

/** Refuse, and say so, while a turn runs. */
const waitForTurn = (ctx: CommandContext, what: string): boolean => {
  if (!ctx.running) return false;
  ctx.notice('warn', `A turn is running; ${what} when it ends, or press Escape to stop it.`);
  return true;
};

/** The CLI's own command, with its output shown here and its name as typed here. */
async function throughCli(ctx: CommandContext, run: (io: { out: (line: string) => void; err: (line: string) => void }) => Promise<number>, cli: string, slash: string): Promise<number> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run({ out: (line) => out.push(line), err: (line) => err.push(line) });
  const rename = (text: string) => text.split(`jamcli ${cli}`).join(`/${slash}`);
  if (out.length) ctx.show(rename(out.join('\n')));
  if (err.length) ctx.notice(code === 0 ? 'warn' : 'error', rename(err.join('\n')));
  return code;
}

/** This session, to open again; one with no turns has no file yet, so a new one stands in. */
const thisSession = (ctx: CommandContext): SessionChoice =>
  fs.existsSync(sessionFileFor(ctx.projectRoot, ctx.runtime.sessionId)) ? { sessionId: ctx.runtime.sessionId } : {};

/** Reopen this session, so a change to the files it was built from applies. */
async function reopen(ctx: CommandContext): Promise<void> {
  // Where the session is not replaced in place, a saved change takes effect in the next one, which is not a failure.
  if (!ctx.opensSessions) return ctx.notice('info', 'Saved. It applies to new sessions.');
  const error = await ctx.openSession(thisSession(ctx));
  if (error) ctx.notice('warn', `Saved, but this session could not reopen with it: ${error}`);
  else ctx.notice('info', 'Applied to this session.');
}

const SCOPES: EditableRuleScope[] = ['session', 'local', 'project', 'user'];
const DECISIONS: Decision[] = ['allow', 'ask', 'deny'];

const help: SlashCommand = {
  name: 'help',
  args: '[command]',
  summary: 'List the commands, or explain one',
  source: 'built-in',
  run(ctx, args) {
    const commands = ctx.commands();
    if (args) {
      const command = findCommand(commands, args.replace(/^\//, '').toLowerCase());
      if (!command) return ctx.notice('warn', `${args} is not a command.`);
      const usage = command.name === 'permissions' ? `\n\n${PERMISSIONS_USAGE}` : command.name === 'config' ? `\n\n${CONFIG_USAGE.split('jamcli config').join('/config')}` : '';
      return ctx.show(`/${command.name}${command.args ? ` ${command.args}` : ''}: ${command.summary}.${command.aliases?.length ? ` Also /${command.aliases.join(', /')}.` : ''}${usage}`);
    }
    const label = (command: SlashCommand) => `/${command.name}${command.args ? ` ${command.args}` : ''}`;
    const detail = (command: SlashCommand) => `${command.summary}${command.source === 'built-in' ? '' : ` (${command.source})`}`;
    // The list only fills the composer, so where there are no keys to move through it, and no composer, it is printed.
    if (!ctx.keyHelp()) return ctx.show(`Commands:\n${commands.map((command) => `  ${label(command)}  ${detail(command)}`).join('\n')}\n/help <command> explains one.`);
    ctx.choose({
      title: 'Commands',
      items: commands.map((command) => ({ key: command.name, label: label(command), detail: detail(command) })),
      empty: 'No commands.',
      ...(ctx.keyHelp() ? { note: ctx.keyHelp() } : {}),
      hint: 'Enter puts the command in the composer',
      choose: (item) => ctx.prefill(`/${item.key} `),
    });
  },
};


const choose: SlashCommand = {
  name: 'choose',
  args: '<key|number|none>',
  summary: 'Answer the list a command offered, where there is no screen to choose on',
  source: 'built-in',
  run(ctx, args) {
    ctx.answerChoice(args);
  },
};

const model: SlashCommand = {
  name: 'model',
  args: '[provider:model|info]',
  summary: 'Choose the model, now and for new sessions, from what the providers offer, or name one',
  source: 'built-in',
  run(ctx, args) {
    if (args === 'info') return ctx.show(modelReport(ctx.runtime.modelInfo));
    const switchTo = async (ref: string) => {
      if (waitForTurn(ctx, 'switch models')) return;
      try {
        ctx.runtime.setModel(ref);
      } catch (error: any) {
        return ctx.notice('warn', `Not switched: ${error?.message ?? error}`);
      }
      ctx.refresh();
      const chosen = `${ctx.runtime.model.provider}:${ctx.runtime.model.model}`;
      ctx.notice('info', `Later turns use ${chosen}.`);
      const request = { action: 'set' as ConfigAction, args: ['model', chosen, '--scope', 'user'] };
      await throughCli(ctx, (io) => runConfigCommand(request, ctx.projectRoot, io), 'config', 'config');
    };
    if (args) return switchTo(args);
    const inUse = `${ctx.runtime.model.provider}:${ctx.runtime.model.model}`;
    ctx.choose({
      title: 'Models the configured providers offer',
      items: ctx.runtime.listModels().then(({ models, problems }) => {
        const items: ChoiceItem[] = models.map((info) => {
          const ref = `${info.provider}:${info.model}`;
          return { key: ref, label: ref, detail: modelDetail(info), ...(ref === inUse ? { current: true } : {}) };
        });
        if (!items.some((item) => item.current)) items.unshift({ key: inUse, label: inUse, detail: modelDetail(ctx.runtime.modelInfo), current: true });
        return { items, ...(problems.length ? { note: `Not listed: ${problems.join('; ')}` } : {}) };
      }),
      empty: 'No provider listed a model. /config provider shows how each is set up.',
      hint: 'Enter switches to it and saves it for new sessions · /model info tells what is known about the one in use',
      choose: (item) => switchTo(item.key),
    });
  },
};

const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}s`;

const jobs: SlashCommand = {
  name: 'jobs',
  args: '[stop <id>]',
  summary: 'List the commands and agents running beside the turn, or stop one',
  source: 'built-in',
  run(ctx, args) {
    const words = args.split(/\s+/).filter(Boolean);
    if (words[0] === 'stop') {
      const id = words[1];
      if (!id) return ctx.notice('warn', 'Name what to stop: /jobs stop <id>. /jobs lists the ids.');
      const stopped = ctx.runtime.stopWork(id);
      return ctx.notice(stopped ? 'info' : 'warn', stopped ? `Stopping ${id}.` : `Nothing named ${id} is running.`);
    }
    if (words.length) return ctx.notice('warn', '/jobs lists what runs beside the turn; /jobs stop <id> stops one.');
    const items = ctx.runtime.work();
    if (!items.length) return ctx.notice('info', 'Nothing runs beside the turn, and nothing has lately.');
    const now = Date.now();
    const lines = items.map((item) => {
      const state = item.endedAt === undefined ? `running ${seconds(now - item.startedAt)}` : `${item.outcome ?? 'ended'} after ${seconds(item.endedAt - item.startedAt)}`;
      return `${item.id}  ${item.kind === 'job' ? 'command' : 'agent'}  ${state}  ${item.label}`;
    });
    ctx.show([...lines, '', 'Stop one with /jobs stop <id>.'].join('\n'));
  },
};

const mode: SlashCommand = {
  name: 'mode',
  args: '[plan|default|accept-edits|auto|bypass]',
  summary: 'Show the permission mode, or switch to another',
  source: 'built-in',
  run(ctx, args) {
    if (!args) return ctx.notice('info', `The mode is ${ctx.runtime.permissionMode}. Choose one with /mode plan, default, accept-edits, auto, or bypass.`);
    if (!isPermissionMode(args)) return ctx.notice('warn', `${args} is not a mode; choose plan, default, accept-edits, auto, or bypass.`);
    if (args === 'bypass') return ctx.confirmBypass();
    ctx.setMode(args);
  },
};

const permissions: SlashCommand = {
  name: 'permissions',
  args: '[allow|ask|deny|remove <rule> [scope]]',
  summary: 'List the permission rules, or add or remove one',
  source: 'built-in',
  run(ctx, args) {
    const words = args.split(/\s+/).filter(Boolean);
    const action = words[0]?.toLowerCase();
    if (!action) return ctx.show(permissionsReport(ctx.runtime.permissionMode, ctx.runtime.permissionRules()));
    if (action === 'remove') {
      const text = words.slice(1).join(' ');
      if (!text) return ctx.notice('warn', PERMISSIONS_USAGE);
      if (waitForTurn(ctx, 'change rules')) return;
      const { removed, kept, error } = ctx.runtime.removePermissionRule(text);
      if (error) return ctx.notice('warn', error);
      const lines = removed.map((rule) => `Removed ${rule.decision} ${rule.text} (${rule.source}).`);
      for (const rule of kept) {
        const why = rule.scope === 'builtin' ? 'it is built in' : rule.scope === 'flag' ? `it comes from ${rule.source}, for this run only` : `it comes from ${rule.source}; change it there`;
        lines.push(`Kept ${rule.decision} ${rule.text}: ${why}.`);
      }
      if (!removed.length && !kept.length) lines.push(`No rule is written as ${text}. /permissions lists them.`);
      ctx.refresh();
      return ctx.show(lines.join('\n'));
    }
    if (!DECISIONS.includes(action as Decision)) return ctx.notice('warn', PERMISSIONS_USAGE);
    const last = words.at(-1)?.toLowerCase() as EditableRuleScope;
    const named = words.length > 2 && SCOPES.includes(last);
    const scope: EditableRuleScope = named ? last : 'local';
    const text = words.slice(1, named ? -1 : undefined).join(' ');
    if (!text) return ctx.notice('warn', PERMISSIONS_USAGE);
    if (waitForTurn(ctx, 'change rules')) return;
    const error = ctx.runtime.addPermissionRule(action as Decision, text, scope);
    if (error) return ctx.notice('warn', `Not added: ${error}`);
    const added = ctx.runtime.permissionRules().at(-1);
    ctx.show(`Added: ${action} ${text}, ${scope === 'session' ? 'for this session only' : `saved in ${added?.source.replace(/ permissions\.\w+$/, '')}`}. It applies to the next call.`);
  },
};

const context: SlashCommand = {
  name: 'context',
  summary: 'Show how full the context is, and when it is compacted',
  source: 'built-in',
  run(ctx) {
    ctx.show(contextReport(ctx.runtime.contextUsage(), ctx.runtime.session.messages.length));
  },
};

const cost: SlashCommand = {
  name: 'cost',
  summary: 'Show what this session has spent, by model',
  source: 'built-in',
  run(ctx) {
    ctx.show(costReport(ctx.runtime.spend()));
  },
};

const compact: SlashCommand = {
  name: 'compact',
  args: '[focus]',
  summary: 'Summarize the earlier conversation now, with an optional focus',
  source: 'built-in',
  async run(ctx, args) {
    if (waitForTurn(ctx, 'compact')) return;
    ctx.working('compacting');
    try {
      const compacted = await ctx.runtime.compact(args || undefined, (event) => ctx.event(event));
      if (!compacted) ctx.notice('info', 'Nothing to compact yet: the conversation is too short.');
    } catch (error: any) {
      ctx.notice('error', `Compaction failed: ${error?.message ?? error}`);
    } finally {
      ctx.working('idle');
      ctx.refresh();
    }
  },
};

const clear: SlashCommand = {
  name: 'clear',
  aliases: ['new'],
  summary: 'Start a new session; this one stays, and /resume opens it again',
  source: 'built-in',
  async run(ctx) {
    if (waitForTurn(ctx, 'start a new session')) return;
    const previous = ctx.runtime.sessionId;
    const error = await ctx.openSession({});
    if (error) return ctx.notice('error', `No new session: ${error}`);
    ctx.notice('info', `New session. The last one is ${previous}; /resume ${previous} opens it again.`);
  },
};

const resume: SlashCommand = {
  name: 'resume',
  args: '[id|list]',
  summary: "Choose one of this project's sessions to open",
  source: 'built-in',
  async run(ctx, args) {
    const sessions = () =>
      readSessionIndex()
        .filter((session) => path.resolve(session.projectRoot) === path.resolve(ctx.projectRoot))
        .sort((a, b) => b.updated.localeCompare(a.updated));
    if (args === 'list') return ctx.show(sessionsReport(sessions().slice(0, 15), ctx.runtime.sessionId));
    const open = async (id: string) => {
      if (id === ctx.runtime.sessionId) return ctx.notice('info', 'That is this session.');
      if (!fs.existsSync(sessionFileFor(ctx.projectRoot, id))) return ctx.notice('warn', `No session ${id} in this project. /resume lists them.`);
      if (waitForTurn(ctx, 'open another session')) return;
      const error = await ctx.openSession({ sessionId: id });
      if (error) return ctx.notice('error', `Not opened: ${error}`);
      ctx.notice('info', `Resumed ${id}.`);
    };
    if (args) return open(args);
    const now = Date.now();
    ctx.choose({
      title: 'Sessions in this project, latest first',
      items: sessions().map((session) => ({ key: session.id, label: session.id, detail: sessionDetail(session, now), ...(session.id === ctx.runtime.sessionId ? { current: true } : {}) })),
      empty: 'No earlier sessions in this project.',
      hint: 'Enter opens it · /resume list prints them',
      choose: (item) => open(item.key),
    });
  },
};

const fork: SlashCommand = {
  name: 'fork',
  summary: 'Copy this session into a new one, and continue in the copy',
  source: 'built-in',
  async run(ctx) {
    if (waitForTurn(ctx, 'fork')) return;
    const source = ctx.runtime.sessionId;
    let forked: string;
    try {
      forked = ctx.runtime.fork();
    } catch (error: any) {
      return ctx.notice('warn', `Not forked: ${error?.message ?? error}`);
    }
    const error = await ctx.openSession({ sessionId: forked });
    if (error) return ctx.notice('error', `Forked into ${forked}, but it could not be opened: ${error}`);
    ctx.notice('info', `Forked ${source} into ${forked}. The original is unchanged, and later turns land in the fork.`);
  },
};

const tools: SlashCommand = {
  name: 'tools',
  summary: 'List the tools the model is offered',
  source: 'built-in',
  run(ctx) {
    ctx.show(toolsReport(ctx.runtime.tools));
  },
};

const MCP_ACTIONS: McpCommandRequest['action'][] = ['list', 'add', 'remove', 'test'];

const mcp: SlashCommand = {
  name: 'mcp',
  args: '[list|add|remove|test]',
  summary: 'Show the MCP servers, or add, remove, or test one',
  source: 'built-in',
  async run(ctx, args) {
    const [first, ...rest] = splitWords(args);
    const action = (first ?? 'list').toLowerCase() as McpCommandRequest['action'];
    if (!MCP_ACTIONS.includes(action)) return ctx.notice('warn', 'Usage: /mcp [list | add <id> --command <cmd> | add <id> --url <url> | remove <id> | test [id]]');
    const changes = action === 'add' || action === 'remove';
    if (changes && waitForTurn(ctx, 'change MCP servers')) return;
    // The MCP SDK loads only when /mcp runs, so the interface draws without it.
    const { runMcpCommand } = await import('../../cli/mcp.js');
    const code = await throughCli(ctx, (io) => runMcpCommand({ action, args: rest }, ctx.projectRoot, io), 'mcp', 'mcp');
    if (changes && code === 0) await reopen(ctx);
  },
};

/** A value as a person would type it after /config set: text bare, anything else as JSON. */
const typed = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

/** The setting the list put in the composer to edit: once it is set, the list opens again on it. */
let editing: string | undefined;

/**
 * Every setting the schema describes, with what it does, its value, and where that comes
 * from. A yes/no or fixed choice opens its choices, which apply at once; anything else is
 * put in the composer as a /config set with its current value, to edit. Either way the
 * list opens again after the change, on the setting changed, so several can be made in turn.
 */
async function pickSetting(ctx: CommandContext, at?: string): Promise<void> {
  const lines: string[] = [];
  const problems: string[] = [];
  await runConfigCommand({ action: 'list', args: ['--json'] }, ctx.projectRoot, { out: (line) => lines.push(line), err: (line) => problems.push(line) });
  const entries = JSON.parse(lines.join('\n') || '[]') as { key: string; origin: string; value: unknown }[];
  const set = new Map(entries.map((entry) => [entry.key, entry]));
  const schema = settingsFromSchema();
  const byKey = new Map(schema.map((setting) => [setting.key, setting]));
  const inside = (key: string) => entries.filter((entry) => entry.key.startsWith(`${key}.`) || entry.key.startsWith(`${key}[`));
  // A value set under no setting the schema names, as one entry of a map, is still shown.
  const extra = entries.filter((entry) => !byKey.has(entry.key) && !schema.some((setting) => entry.key.startsWith(`${setting.key}.`) || entry.key.startsWith(`${setting.key}[`)));
  const shorten = (text: string) => (text.length > 40 ? `${text.slice(0, 39)}…` : text);
  const items: ChoiceItem[] = [
    ...schema.map((setting): ChoiceItem => {
      const entry = set.get(setting.key);
      const within = entry ? [] : inside(setting.key);
      const origin = originOf(entry?.origin ?? within[0]?.origin, ctx.projectRoot).words;
      const value = entry ? ` = ${shorten(JSON.stringify(entry.value))}` : within.length ? ` (${within.length} set)` : '';
      return { key: setting.key, label: `${setting.key}${value}`, detail: [origin, setting.description].filter(Boolean).join(' · ') };
    }),
    ...extra.map((entry) => ({ key: entry.key, label: `${entry.key} = ${shorten(JSON.stringify(entry.value))}`, detail: originOf(entry.origin, ctx.projectRoot).words })),
  ];
  // What the person has set comes first; the rest keep the schema's order.
  const changed = (item: ChoiceItem) => !(item.detail ?? '').startsWith('default');
  ctx.choose({
    title: 'Settings: what each does, its value, and where it comes from',
    items: [...items.filter(changed), ...items.filter((item) => !changed(item))],
    empty: 'No settings.',
    ...(problems.length ? { note: problems.join('; ') } : {}),
    hint: 'Enter changes it · type to find one, such as sandbox · /config provider shows the providers',
    ...(at ? { at } : {}),
    choose: (item) => {
      const setting = byKey.get(item.key);
      const entry = set.get(item.key);
      if (setting?.choices) return chooseValue(ctx, setting, entry);
      editing = item.key;
      ctx.prefill(`/config set ${item.key} ${entry && setting?.kind !== 'map' ? typed(entry.value) : ''}`, () => {
        editing = undefined;
        void pickSetting(ctx, item.key);
      });
      ctx.notice('info', `Edit the value of ${item.key} and press Enter to set it, or Escape to go back to the settings.`);
    },
  });
}

/** A yes/no or fixed choice, saved in the file it is set in, or else the person's own settings. */
function chooseValue(ctx: CommandContext, setting: Setting, entry: { origin: string; value: unknown } | undefined): void {
  const scope = originOf(entry?.origin, ctx.projectRoot).scope ?? 'user';
  ctx.choose({
    title: `${setting.key}, saved in ${SCOPE_WORDS[scope]}`,
    items: setting.choices!.map((choice) => ({ key: choice, label: choice, ...(entry && String(entry.value) === choice ? { current: true } : {}) })),
    empty: 'No choices.',
    ...(setting.description ? { note: setting.description } : {}),
    hint: 'Enter sets it now · Escape goes back to the settings',
    dismissed: () => void pickSetting(ctx, setting.key),
    choose: async (item) => {
      if (!item.current && !waitForTurn(ctx, 'change settings')) {
        const request = { action: 'set' as ConfigAction, args: [setting.key, item.key, '--scope', scope] };
        const code = await throughCli(ctx, (io) => runConfigCommand(request, ctx.projectRoot, io), 'config', 'config');
        if (code === 0) await reopen(ctx);
      }
      await pickSetting(ctx, setting.key);
    },
  });
}

const config: SlashCommand = {
  name: 'config',
  args: '[list|get|set|unset|provider]',
  summary: 'Show or change settings, each with the file it comes from',
  source: 'built-in',
  async run(ctx, args) {
    const [first, ...rest] = splitWords(args);
    const edited = editing;
    editing = undefined;
    if (!first) return pickSetting(ctx);
    const action = first.toLowerCase();
    if (action === 'provider' || action === 'providers') {
      const loaded = loadConfig({ projectRoot: ctx.projectRoot });
      return ctx.show(providersReport(loaded.config.api_registry ?? {}, process.env, (account) => Boolean(storedKey(account))));
    }
    if (!CONFIG_ACTIONS.includes(action as ConfigAction)) return ctx.notice('warn', CONFIG_USAGE.split('jamcli config').join('/config'));
    const changes = action === 'set' || action === 'unset' || (action === 'migrate' && !rest.includes('--dry-run'));
    if (changes && waitForTurn(ctx, 'change settings')) return;
    const request = { action: action as ConfigAction, args: action === 'list' && !rest.length ? ['--show-origin'] : rest };
    const code = await throughCli(ctx, (io) => runConfigCommand(request, ctx.projectRoot, io), 'config', 'config');
    if (changes && code === 0) await reopen(ctx);
    // A setting edited from the list goes back to the list, whether or not the value took.
    if (edited && action === 'set' && rest[0] === edited) await pickSetting(ctx, edited);
  },
};

/** What a copy did, in a line. */
export function copiedLine(text: string, how: 'system' | 'terminal'): string {
  const size = `${text.length.toLocaleString('en-US')} character${text.length === 1 ? '' : 's'}`;
  return how === 'system' ? `${size}, to the clipboard.` : `${size}, through the terminal (OSC 52); a terminal that does not support it ignores the request.`;
}

const copy: SlashCommand = {
  name: 'copy',
  args: '[o] [count] | debug',
  summary: 'Copy the conversation to the clipboard; o copies only replies, a count the last few, and debug every event of the session log',
  source: 'built-in',
  async run(ctx, args) {
    const words = args.split(/\s+/).filter(Boolean);
    const usage = 'Usage: /copy [o] [count], or /copy debug, such as /copy, /copy o, /copy o 3, or /copy debug.';
    if (words[0] === 'debug') {
      // A partial log is not the log, so debug takes nothing after it.
      if (words.length > 1) return ctx.notice('warn', usage);
      const log = debugTranscript(ctx.projectRoot, ctx.runtime.session.id);
      if (!log) return ctx.notice('info', 'Nothing is recorded yet: the log starts with the first message.');
      const { file, events, text } = log;
      const how = await ctx.copy(text);
      if (how) ctx.notice('info', `Copied the session log, ${events.length} event${events.length === 1 ? '' : 's'} from ${displayPath(file, ctx.projectRoot)}, ${copiedLine(text, how)}`);
      else ctx.notice('warn', `This terminal cannot take text for the clipboard, so nothing was copied. The log is ${displayPath(file, ctx.projectRoot)}.`);
      return;
    }
    const onlyReplies = words[0] === 'o';
    const limitText = onlyReplies ? words[1] : words[0];
    const limit = limitText === undefined ? undefined : Number(limitText);
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) return ctx.notice('warn', usage);
    const messages = ctx.runtime.session.messages.filter((message) => (onlyReplies ? message.role === 'assistant' : message.role === 'user' || message.role === 'assistant') && message.content?.trim());
    const chosen = limit ? messages.slice(-limit) : messages;
    if (!chosen.length) return ctx.notice('info', 'Nothing to copy yet.');
    const text = chosen.map((message) => (onlyReplies ? message.content : `${message.role === 'user' ? 'You' : 'JamCLI'}: ${message.content}`)).join('\n\n');
    const noun = onlyReplies ? (chosen.length === 1 ? 'reply' : 'replies') : chosen.length === 1 ? 'message' : 'messages';
    const what = `${chosen.length} ${noun}`;
    const how = await ctx.copy(text);
    if (how) ctx.notice('info', `Copied ${what}, ${copiedLine(text, how)}`);
    else ctx.notice('warn', `This terminal cannot take text for the clipboard, so nothing was copied. /export writes the session to a file instead.`);
  },
};

const profile: SlashCommand = {
  name: 'profile',
  args: '[name]',
  summary: 'Show the profiles, or switch this session to one',
  source: 'built-in',
  async run(ctx, args) {
    const dirs = [path.join(path.dirname(userConfigFile()), 'profiles'), path.join(ctx.projectRoot, '.jamcli', 'profiles')];
    const names = [...new Set(dirs.flatMap((dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5)))].sort();
    const active = ctx.profile ?? loadConfig({ projectRoot: ctx.projectRoot }).config.active_profile ?? 'default';
    if (!args) {
      if (!names.length) {
        const home = os.homedir();
        const mine = path.join(userConfigDir(), 'profiles');
        const shown = mine.startsWith(home + path.sep) ? `~${mine.slice(home.length)}` : mine;
        return ctx.show(`The profile is ${active}, from the defaults. Profiles are files in ${shown}${path.sep} or .jamcli/profiles/.`);
      }
      return ctx.show([`The profile is ${active}.`, 'Profiles:', ...names.map((name) => `- ${name}${name === active ? ' (this one)' : ''}`), '', 'Switch this session with /profile <name>.'].join('\n'));
    }
    if (!names.includes(args)) return ctx.notice('warn', `No profile ${args}. Profiles: ${names.join(', ') || 'none'}.`);
    if (waitForTurn(ctx, 'switch profiles')) return;
    const error = await ctx.openSession({ ...thisSession(ctx), profile: args });
    if (error) return ctx.notice('error', `Not switched: ${error}`);
    ctx.notice('info', `This session now uses the ${args} profile. Nothing was written; the next start uses the configured one.`);
  },
};

const THEME_WORDS: Record<ThemeName, string> = {
  dark: 'light text on a dark background',
  light: 'dark text on a light background',
  'high-contrast': 'the brightest colors, for low vision or bright rooms',
  monochrome: 'no color at all; every state is still a word',
};

const theme: SlashCommand = {
  name: 'theme',
  args: '[dark|light|high-contrast|monochrome]',
  summary: 'Choose the colors, saved for every project',
  source: 'built-in',
  async run(ctx, args) {
    const apply = async (name: ThemeName) => {
      const forced = noColor(process.env);
      ctx.setTheme(name);
      const out: string[] = [];
      const code = await runConfigCommand({ action: 'set', args: ['ui.theme', name, '--scope', 'user'] }, ctx.projectRoot, { out: (line) => out.push(line), err: (line) => out.push(line) });
      const saved = code === 0 ? ' It is saved in your user configuration.' : ` It could not be saved: ${out.join(' ')}`;
      ctx.notice(code === 0 ? 'info' : 'warn', `Theme: ${name}.${saved}${forced ? ' NO_COLOR is set, so colors stay off until it is unset.' : ''}`);
    };
    if (args) {
      if (!THEME_NAMES.includes(args as ThemeName)) return ctx.notice('warn', `${args} is not a theme; choose ${THEME_NAMES.join(', ')}.`);
      return apply(args as ThemeName);
    }
    ctx.choose({
      title: 'Themes',
      items: THEME_NAMES.map((name) => ({ key: name, label: name, detail: THEME_WORDS[name], ...(ctx.themeName === name ? { current: true } : {}) })),
      empty: 'No themes.',
      hint: 'Enter uses it and saves it',
      choose: (item) => apply(item.key as ThemeName),
    });
  },
};

/** Each agent in words: what it is for, what it runs on, where it came from. */
const agentReport = (loaded: LoadedAgents, projectRoot: string): string[] => {
  const label = (file: string) => displayPath(file, projectRoot);
  const lines = ['Agents that delegated work runs on:'];
  for (const agent of Object.values(loaded.agents).sort((a, b) => a.name.localeCompare(b.name))) {
    const marks = [agent.name === loaded.defaultAgent ? 'default' : '', agent.rules ? 'has rules' : ''].filter(Boolean).join(', ');
    lines.push(`- ${agent.name}${marks ? ` (${marks})` : ''}: ${agent.description ?? 'no description'}`);
    lines.push(`    runs on ${describeRun(agent)} · from ${describeSource(agent.source, label)}`);
  }
  lines.push('', loaded.defaultAgent ? `A task that names no agent runs on ${loaded.defaultAgent}.` : 'No agent is the default, so every task must name one.');
  lines.push('Define or replace one with .jamcli/agents/<name>.md; the session keeps its own model.');
  return lines;
};

const agentsCommand: SlashCommand = {
  name: 'agents',
  args: '[list|<name>]',
  summary: 'List the agents delegated work runs on, or choose the default',
  source: 'built-in',
  async run(ctx, args) {
    const config = loadConfig({ projectRoot: ctx.projectRoot }).config;
    const loaded = loadAgents(ctx.projectRoot, config);
    if (loaded.problems.length) ctx.notice('warn', loaded.problems.join('\n'));
    const choose = async (name: string) => {
      if (!loaded.agents[name]) return ctx.notice('warn', `No agent named ${name}. The agents are ${Object.keys(loaded.agents).sort().join(', ')}.`);
      if (waitForTurn(ctx, 'change the default agent')) return;
      const request = { action: 'set' as ConfigAction, args: ['delegation.default_agent', name] };
      const code = await throughCli(ctx, (io) => runConfigCommand(request, ctx.projectRoot, io), 'config', 'config');
      if (code === 0) await reopen(ctx);
    };
    const word = args.trim();
    if (word === 'list') return ctx.show(agentReport(loaded, ctx.projectRoot).join('\n'));
    if (word) return choose(word);
    const label = (file: string) => displayPath(file, ctx.projectRoot);
    ctx.choose({
      title: 'Agents delegated work runs on',
      items: Object.values(loaded.agents)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((agent) => ({
          key: agent.name,
          label: agent.name,
          detail: [agent.description, `runs on ${describeRun(agent)}`, describeSource(agent.source, label), agent.rules ? 'has rules' : '']
            .filter(Boolean)
            .join(' · '),
          ...(agent.name === loaded.defaultAgent ? { current: true } : {}),
        })),
      empty: 'No agents.',
      hint: 'Enter makes it the default for tasks that name none · /agents list prints this',
      choose: (item) => choose(item.key),
    });
  },
};

const doctor: SlashCommand = {
  name: 'doctor',
  summary: 'Check the configuration, models, tools, sandbox, and MCP servers',
  source: 'built-in',
  async run(ctx) {
    ctx.notice('info', 'Checking…');
    const { renderChecks, runChecks } = await import('../../cli/doctor.js');
    const checks = await runChecks({ projectRoot: ctx.projectRoot });
    ctx.show(renderChecks(checks, ctx.projectRoot));
  },
};

const THINKING_WORDS: Record<ThinkingChoice, string> = {
  off: 'no thinking',
  auto: "the model's own default",
  on: 'thinking on, at the default level',
  low: 'thinks briefly',
  medium: 'thinks moderately',
  high: 'thinks hard',
  xhigh: 'thinks harder',
  max: 'thinks as hard as the model can',
};

/** What a choice does on the model in use: a level it does not take goes as the nearest it does. */
const thinkingDetail = (choice: ThinkingChoice, runtime: Runtime): string => {
  const info = runtime.modelInfo;
  const words = [THINKING_WORDS[choice]];
  if (isEffortLevel(choice)) {
    if (info.effort === false || (info.effort === undefined && !info.efforts)) words.push('this model takes no level, so it only turns thinking on');
    else if (effortFor(choice, info.efforts) !== choice) words.push(`this model takes ${info.efforts!.join(', ')}, so it goes as ${effortFor(choice, info.efforts)}`);
  }
  if (choice !== 'off' && choice !== 'auto' && info.reasoning === false) words.push('this model does not think');
  if (choice === 'off' && info.alwaysThinks) words.push('this model always thinks, so it cannot be turned off');
  return words.join(' · ');
};

const effort: SlashCommand = {
  name: 'effort',
  aliases: ['thinking'],
  args: `[${THINKING_CHOICES.join('|')}]`,
  summary: 'Choose how hard the model thinks, now and for new sessions',
  source: 'built-in',
  run(ctx, args) {
    const choose = async (choice: ThinkingChoice) => {
      if (waitForTurn(ctx, 'change the effort')) return;
      ctx.runtime.setThinking(thinkingFor(choice));
      ctx.refresh();
      ctx.notice('info', `Later turns: ${thinkingDetail(choice, ctx.runtime)}.`);
      const request = { action: 'set' as ConfigAction, args: ['effort', choice, '--scope', 'user'] };
      await throughCli(ctx, (io) => runConfigCommand(request, ctx.projectRoot, io), 'config', 'config');
    };
    const word = args.trim().toLowerCase();
    if (word) {
      if (!isThinkingChoice(word)) return ctx.notice('warn', `The effort is one of ${THINKING_CHOICES.join(', ')}, not ${word}.`);
      return choose(word);
    }
    const current = choiceOf(ctx.runtime.thinking);
    ctx.choose({
      title: `How ${ctx.runtime.model.provider}:${ctx.runtime.model.model} thinks`,
      items: THINKING_CHOICES.map((choice) => ({
        key: choice,
        label: choice,
        detail: thinkingDetail(choice, ctx.runtime),
        ...(choice === current ? { current: true } : {}),
      })),
      empty: 'No choices.',
      hint: `Enter applies it now and keeps it for new sessions · levels run ${EFFORT_LEVELS[0]} to ${EFFORT_LEVELS[EFFORT_LEVELS.length - 1]}`,
      choose: (item) => choose(item.key as ThinkingChoice),
    });
  },
};

const exportCommand: SlashCommand = {
  name: 'export',
  args: '[file]',
  summary: 'Write this session to a Markdown file',
  source: 'built-in',
  run(ctx, args) {
    const id = ctx.runtime.sessionId;
    const source = sessionFileFor(ctx.projectRoot, id);
    if (!fs.existsSync(source)) return ctx.notice('info', 'Nothing to export yet.');
    const target = path.resolve(ctx.projectRoot, args || `jamcli-${id}.md`);
    if (fs.existsSync(target)) return ctx.notice('warn', `${path.relative(ctx.projectRoot, target) || target} exists; name another file.`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, transcriptToMarkdown(readTranscript(source), { id }), 'utf8');
    ctx.notice('info', `Wrote ${path.relative(ctx.projectRoot, target)}.`);
  },
};

const note: SlashCommand = {
  name: 'note',
  aliases: ['notes'],
  args: '<text>|clear',
  summary: 'Flag a tester note at this point of the session; it is kept in the log and never reaches the model. clear hides them here',
  source: 'built-in',
  run(ctx, args) {
    if (args.toLowerCase() === 'clear') {
      ctx.clearNotes();
      return ctx.notice('info', 'Notes hidden here. The session log keeps them; /copy debug shows them.');
    }
    if (!args) return ctx.notice('warn', 'Usage: /note <text> flags a note at this point; /notes clear hides them here.');
    ctx.note(args);
  },
};

const exit: SlashCommand = {
  name: 'exit',
  aliases: ['quit'],
  summary: 'Leave JamCLI',
  source: 'built-in',
  run(ctx) {
    ctx.exit();
  },
};

/** The built-in commands, in the order help lists them. */
export const BUILTIN_COMMANDS: SlashCommand[] = [
  help,
  choose,
  setup,
  model,
  style,
  mode,
  permissions,
  context,
  cost,
  compact,
  clear,
  resume,
  fork,
  undo,
  rewind,
  diff,
  commit,
  pr,
  tools,
  jobs,
  skills,
  commandsList,
  plugins,
  workflowsCommand,
  hooksCommand,
  mcp,
  config,
  copy,
  profile,
  theme,
  agentsCommand,
  effort,
  reflect,
  note,
  doctor,
  exportCommand,
  exit,
];
