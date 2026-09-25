import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RunOptions, Runtime } from '../../core/runtime/index.js';
import type { EditableRuleScope } from '../../core/runtime/index.js';
import { isPermissionMode, type PermissionMode } from '../../core/permissions/modes.js';
import type { Decision } from '../../core/permissions/rules.js';
import { loadConfig, userConfigFile } from '../../core/config/load.js';
import { storedKey } from '../../core/config/credentials.js';
import { userConfigDir } from '../../utils/paths.js';
import { DEFAULT_CATEGORIES, describeChain, listCategories } from '../../core/routing/categories.js';
import { readSessionIndex, readTranscript, sessionFileFor, transcriptToMarkdown } from '../../core/transcript/index.js';
import { CONFIG_ACTIONS, CONFIG_USAGE, runConfigCommand, type ConfigAction } from '../../cli/config.js';
import type { McpCommandRequest } from '../../cli/mcp.js';
import type { ViewAction } from '../state/view.js';
import { contextReport, costReport, modelDetail, modelReport, permissionsReport, PERMISSIONS_USAGE, providersReport, sessionDetail, sessionsReport, toolsReport } from './reports.js';
import type { PickItem, PickRequest } from './Picker.js';
import { THEME_NAMES, THEMES, noColor, type Theme } from './theme.js';
import { keysHelp, type Keybindings } from './keys.js';
import { setup } from './setup.js';
import { style } from './style.js';
import { rewind, undo } from './rewind.js';
import { diff } from './review.js';
import { commit } from './commit.js';
import { pr } from './pr.js';
import type { StatusStyleDefinition } from '../../styles/statusStyles.js';
import type { ThemeName } from '../../types/config.js';

/** Where a command comes from. The palette shows a custom command's source. */
export type CommandSource = 'built-in' | 'user' | 'project';

/** A session to open in place of the current one. */
export interface SessionChoice {
  /** Continue this session; a new one when absent. */
  sessionId?: string;
  /** Open it with this profile, for the rest of the interface's life. */
  profile?: string;
}

/** What a command may do. The interface supplies it; commands never touch rendering. */
export interface CommandContext {
  readonly runtime: Runtime;
  readonly projectRoot: string;
  /** Whether a turn is running. Commands that change the session wait for it to end. */
  readonly running: boolean;
  /** The profile chosen with /profile, when one was; otherwise the configured one applies. */
  readonly profile?: string;
  /** Add what the command reports to the transcript. */
  show(text: string): void;
  notice(level: 'info' | 'warn' | 'error', text: string): void;
  /** Fold runtime events into the view, as a compaction's. */
  dispatch(action: ViewAction): void;
  /** Read the status line's facts from the runtime again. */
  refresh(): void;
  /** Close this session and open another. Resolves to why not, when it could not. */
  openSession(choice: SessionChoice): Promise<string | undefined>;
  setMode(mode: PermissionMode): void;
  /** Ask the person to confirm bypass mode. */
  confirmBypass(): void;
  /** Put text on the clipboard through the terminal. Resolves false when the terminal cannot. */
  copy(text: string): boolean;
  exit(): void;
  /** Every command, for /help. */
  commands(): SlashCommand[];
  /** Open an overlay to choose from. */
  pick(request: PickRequest): void;
  readonly theme: Theme;
  setTheme(theme: Theme): void;
  /** The working indicator's style. */
  readonly statusStyle: StatusStyleDefinition;
  setStatusStyle(style: StatusStyleDefinition): void;
  /** Put text in the composer for the person to finish. */
  prefill(text: string): void;
  /** Send a prompt as a turn, showing `display` as what was typed, as a custom command does. */
  send(prompt: string, options?: RunOptions & { display?: string }): void;
  /** The keys in effect, for help. */
  readonly keys: Keybindings;
}

export interface SlashCommand {
  /** Without the slash. */
  name: string;
  aliases?: string[];
  /** What follows the name, as help shows it. */
  args?: string;
  summary: string;
  source: CommandSource;
  run(ctx: CommandContext, args: string): void | Promise<void>;
}

/** A command line split into its name and the rest. */
export function parseCommand(text: string): { name: string; args: string } | undefined {
  const match = /^\/(\S*)\s*([\s\S]*)$/.exec(text.trim());
  return match ? { name: match[1].toLowerCase(), args: match[2].trim() } : undefined;
}

/** Words as a shell would split them: quotes keep spaces, and backslashes escape. */
export function splitWords(text: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: string | undefined;
  let started = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = undefined;
      else if (char === '\\' && quote === '"' && index + 1 < text.length) current += text[++index];
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === '\\' && index + 1 < text.length) {
      current += text[++index];
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) words.push(current);
  return words;
}

/** The commands a typed prefix could mean: names that start with it first, then names that contain it. */
export function matchCommands(commands: SlashCommand[], typed: string): SlashCommand[] {
  const wanted = typed.replace(/^\//, '').toLowerCase();
  const names = (command: SlashCommand) => [command.name, ...(command.aliases ?? [])];
  const starts = commands.filter((command) => names(command).some((name) => name.startsWith(wanted)));
  const contains = commands.filter((command) => !starts.includes(command) && names(command).some((name) => name.includes(wanted)));
  return [...starts, ...contains];
}

export function findCommand(commands: SlashCommand[], name: string): SlashCommand | undefined {
  return commands.find((command) => command.name === name || command.aliases?.includes(name));
}

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
  const error = await ctx.openSession(thisSession(ctx));
  if (error) ctx.notice('warn', `The change is saved, but this session could not be reopened with it: ${error}`);
  else ctx.notice('info', 'This session was reopened, so the change applies.');
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
    ctx.pick({
      title: 'Commands',
      items: commands.map((command) => ({
        key: command.name,
        label: `/${command.name}${command.args ? ` ${command.args}` : ''}`,
        detail: `${command.summary}${command.source === 'built-in' ? '' : ` (${command.source})`}`,
      })),
      empty: 'No commands.',
      note: keysHelp(ctx.keys),
      hint: 'Enter puts the command in the composer',
      choose: (item) => ctx.prefill(`/${item.key} `),
    });
  },
};


const model: SlashCommand = {
  name: 'model',
  args: '[provider:model|info]',
  summary: 'Choose the model from what the providers offer, or name one',
  source: 'built-in',
  run(ctx, args) {
    if (args === 'info') return ctx.show(modelReport(ctx.runtime.modelInfo));
    const switchTo = (ref: string) => {
      if (waitForTurn(ctx, 'switch models')) return;
      try {
        ctx.runtime.setModel(ref);
        ctx.refresh();
        ctx.notice('info', `Later turns use ${ctx.runtime.model.provider}:${ctx.runtime.model.model}.`);
      } catch (error: any) {
        ctx.notice('warn', `Not switched: ${error?.message ?? error}`);
      }
    };
    if (args) return switchTo(args);
    const inUse = `${ctx.runtime.model.provider}:${ctx.runtime.model.model}`;
    ctx.pick({
      title: 'Models the configured providers offer',
      items: ctx.runtime.listModels().then(({ models, problems }) => {
        const items: PickItem[] = models.map((info) => {
          const ref = `${info.provider}:${info.model}`;
          return { key: ref, label: ref, detail: modelDetail(info), ...(ref === inUse ? { current: true } : {}) };
        });
        if (!items.some((item) => item.current)) items.unshift({ key: inUse, label: inUse, detail: modelDetail(ctx.runtime.modelInfo), current: true });
        return { items, ...(problems.length ? { note: `Not listed: ${problems.join('; ')}` } : {}) };
      }),
      empty: 'No provider listed a model. /config provider shows how each is set up.',
      hint: 'Enter switches later turns to it · /model info tells what is known about the one in use',
      choose: (item) => switchTo(item.key),
    });
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
    ctx.dispatch({ type: 'status', patch: { phase: 'compacting' } });
    try {
      const compacted = await ctx.runtime.compact(args || undefined, (event) => ctx.dispatch({ type: 'event', event }));
      if (!compacted) ctx.notice('info', 'Nothing to compact yet: the conversation is too short.');
    } catch (error: any) {
      ctx.notice('error', `Compaction failed: ${error?.message ?? error}`);
    } finally {
      ctx.dispatch({ type: 'status', patch: { phase: 'idle' } });
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
    ctx.pick({
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

/** Every value set, with the file it comes from; choosing one starts a /config set for it. */
async function pickSetting(ctx: CommandContext): Promise<void> {
  const lines: string[] = [];
  const problems: string[] = [];
  await runConfigCommand({ action: 'list', args: ['--json'] }, ctx.projectRoot, { out: (line) => lines.push(line), err: (line) => problems.push(line) });
  const entries = JSON.parse(lines.join('\n') || '[]') as { key: string; origin: string; value: unknown }[];
  ctx.pick({
    title: 'Settings, each with the file it comes from',
    items: entries.map((entry) => ({ key: entry.key, label: `${entry.key} = ${JSON.stringify(entry.value)}`, detail: entry.origin })),
    empty: 'Nothing is set beyond the defaults.',
    ...(problems.length ? { note: problems.join('; ') } : {}),
    hint: 'Enter starts /config set for it · /config provider shows the providers',
    choose: (item) => ctx.prefill(`/config set ${item.key} `),
  });
}

const config: SlashCommand = {
  name: 'config',
  args: '[list|get|set|unset|provider]',
  summary: 'Show or change settings, each with the file it comes from',
  source: 'built-in',
  async run(ctx, args) {
    const [first, ...rest] = splitWords(args);
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
  },
};

const copy: SlashCommand = {
  name: 'copy',
  args: '[o] [count]',
  summary: 'Copy the conversation to the clipboard; o copies only replies, and a count the last few',
  source: 'built-in',
  run(ctx, args) {
    const words = args.split(/\s+/).filter(Boolean);
    const onlyReplies = words[0] === 'o';
    const limitText = onlyReplies ? words[1] : words[0];
    const limit = limitText === undefined ? undefined : Number(limitText);
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) return ctx.notice('warn', 'Usage: /copy [o] [count], such as /copy, /copy o, or /copy o 3.');
    const messages = ctx.runtime.session.messages.filter((message) => (onlyReplies ? message.role === 'assistant' : message.role === 'user' || message.role === 'assistant') && message.content?.trim());
    const chosen = limit ? messages.slice(-limit) : messages;
    if (!chosen.length) return ctx.notice('info', 'Nothing to copy yet.');
    const text = chosen.map((message) => (onlyReplies ? message.content : `${message.role === 'user' ? 'You' : 'JamCLI'}: ${message.content}`)).join('\n\n');
    const noun = onlyReplies ? (chosen.length === 1 ? 'reply' : 'replies') : chosen.length === 1 ? 'message' : 'messages';
    const what = `${chosen.length} ${noun}`;
    if (ctx.copy(text)) ctx.notice('info', `Copied ${what}, ${text.length.toLocaleString('en-US')} characters, through the terminal (OSC 52). A terminal that does not support it ignores the request.`);
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
      ctx.setTheme(forced ? THEMES.monochrome : THEMES[name]);
      const out: string[] = [];
      const code = await runConfigCommand({ action: 'set', args: ['ui.theme', name, '--scope', 'user'] }, ctx.projectRoot, { out: (line) => out.push(line), err: (line) => out.push(line) });
      const saved = code === 0 ? ' It is saved in your user configuration.' : ` It could not be saved: ${out.join(' ')}`;
      ctx.notice(code === 0 ? 'info' : 'warn', `Theme: ${name}.${saved}${forced ? ' NO_COLOR is set, so colors stay off until it is unset.' : ''}`);
    };
    if (args) {
      if (!THEME_NAMES.includes(args as ThemeName)) return ctx.notice('warn', `${args} is not a theme; choose ${THEME_NAMES.join(', ')}.`);
      return apply(args as ThemeName);
    }
    ctx.pick({
      title: 'Themes',
      items: THEME_NAMES.map((name) => ({ key: name, label: name, detail: THEME_WORDS[name], ...(ctx.theme.name === name ? { current: true } : {}) })),
      empty: 'No themes.',
      hint: 'Enter uses it and saves it',
      choose: (item) => apply(item.key as ThemeName),
    });
  },
};

const categories: SlashCommand = {
  name: 'categories',
  summary: 'Show the model categories that delegated work is routed by',
  source: 'built-in',
  run(ctx) {
    const configured = loadConfig({ projectRoot: ctx.projectRoot }).config.categories;
    const own = configured && Object.keys(configured).length > 0;
    const lines = [`Model categories (${own ? 'configured' : 'defaults'}):`];
    for (const entry of listCategories(own ? configured : DEFAULT_CATEGORIES)) lines.push(`- ${entry.name}: ${describeChain(entry.chain)}`);
    lines.push('', 'Categories route delegated work; the session keeps its own model.');
    ctx.show(lines.join('\n'));
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
  mcp,
  config,
  copy,
  profile,
  theme,
  categories,
  doctor,
  exportCommand,
  exit,
];
