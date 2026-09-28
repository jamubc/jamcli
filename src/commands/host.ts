import type { RunOptions, Runtime } from '../core/runtime/index.js';
import type { PermissionMode } from '../core/permissions/modes.js';
import type { AgentEvent } from '../core/types.js';
import { loadConfig } from '../core/config/load.js';
import { DEFAULT_STATUS_STYLE } from '../styles/statusStyles.js';
import type { Copier } from '../utils/clipboard.js';
import { BUILTIN_COMMANDS } from './builtin/index.js';
import { customCommands, slashCommandForPrompt } from './custom.js';
import { findCommand, parseCommand } from './parse.js';
import type { ChoiceItem, ChoiceRequest, CommandContext, NoticeLevel, SlashCommand } from './types.js';

/** What a command produced where there is no screen, in order. */
export type HostEntry =
  | { kind: 'output'; text: string; diff?: string }
  | { kind: 'notice'; level: NoticeLevel; text: string }
  /** A list offered: answered with /choose, or in advance. */
  | { kind: 'choice'; title: string; items: ChoiceItem[]; note?: string; hint?: string; freeText?: string; personOnly?: boolean; answer: string }
  /** A command line for the person to finish and send. */
  | { kind: 'prefill'; text: string }
  /** A runtime event the command caused outside a turn, as a compaction's. */
  | { kind: 'event'; event: AgentEvent };

export interface CommandHostOptions {
  runtime: Runtime;
  projectRoot: string;
  onEntry(entry: HostEntry): void;
  /** Run a turn a command sends; resolves when it ends. */
  runTurn(prompt: string, options: RunOptions & { display?: string }): Promise<unknown>;
  /** Why another session cannot be opened here, and how it is done on this surface. */
  openRefusal: string;
  /** How a list is answered here, said under it. */
  answerHint: string;
  /**
   * Whether anything can be sent after this command. Where nothing can (headless), a list
   * with no answer given in advance is reported and closed.
   */
  laterInput: boolean;
  /** Answers given in advance, each for the next list offered, in order. */
  answers?: string[];
  copy?: Copier;
  /** The mode changed. */
  onMode?(mode: PermissionMode): void;
  /** The session's facts may have changed, such as its model. */
  onRefresh?(): void;
  /** A command asked to leave. */
  onExit?(): void;
}

const BYPASS_HERE =
  'Bypass mode is entered only where you can confirm it: in the interface with /mode bypass, or with --dangerously-bypass-permissions when JamCLI starts.';

/**
 * The command context where there is no screen: headless invocation and ACP. It runs the
 * same commands the interface does, reports what they produce as entries, holds the one
 * list waiting for an answer, and waits until everything a command started has finished.
 */
export class CommandHost {
  private readonly work = new Set<Promise<unknown>>();
  private readonly answers: string[];
  private extra: SlashCommand[] = [];
  private pending: { request: ChoiceRequest; items: ChoiceItem[] } | undefined;
  private turn = false;
  /** The sticky notes /note pinned, newest first. */
  readonly notes: string[] = [];

  constructor(private readonly options: CommandHostOptions) {
    this.answers = [...(options.answers ?? [])];
  }

  get runtime(): Runtime {
    return this.options.runtime;
  }

  /** Read the custom commands and the MCP servers' prompts, so they run here as they do in the interface. */
  async load(): Promise<void> {
    const custom = customCommands(this.options.projectRoot, BUILTIN_COMMANDS).commands;
    const prompts = (await this.options.runtime.mcpPrompts().catch(() => []))
      .map(slashCommandForPrompt)
      .filter((command) => !BUILTIN_COMMANDS.some((builtIn) => builtIn.name === command.name));
    this.extra = [...custom, ...prompts];
  }

  commands(): SlashCommand[] {
    return [...BUILTIN_COMMANDS, ...this.extra];
  }

  /** The command a line names, when it names one. */
  commandFor(line: string): SlashCommand | undefined {
    const parsed = parseCommand(line);
    return parsed ? findCommand(this.commands(), parsed.name) : undefined;
  }

  /** The list waiting for an answer, when there is one. */
  get waiting(): { request: ChoiceRequest; items: ChoiceItem[] } | undefined {
    return this.pending;
  }

  /**
   * Run a command line and wait until everything it started has finished: the turns it
   * sent, and what the lists it offered did once answered. A list left waiting for an
   * answer does not hold it up.
   */
  async run(line: string): Promise<void> {
    const parsed = parseCommand(line);
    if (!parsed) return;
    const command = findCommand(this.commands(), parsed.name);
    if (this.pending && command?.name !== 'choose') this.dismiss(`The list "${this.pending.request.title}" was closed without a choice.`);
    if (!command) return this.emit({ kind: 'notice', level: 'warn', text: `/${parsed.name} is not a command. /help lists them.` });
    try {
      await command.run(this.context(), parsed.args);
    } catch (error: any) {
      this.emit({ kind: 'notice', level: 'error', text: `/${command.name} failed: ${error?.message ?? error}` });
    }
    await this.settled();
  }

  /** Close the waiting list, as Escape does. */
  dismiss(reason?: string): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    if (reason) this.emit({ kind: 'notice', level: 'info', text: reason });
    pending.request.dismissed?.();
  }

  private emit(entry: HostEntry): void {
    this.options.onEntry(entry);
  }

  private track(work: Promise<unknown>): void {
    const tracked = work.catch((error: any) => this.emit({ kind: 'notice', level: 'error', text: error?.message ?? String(error) }));
    this.work.add(tracked);
    void tracked.finally(() => this.work.delete(tracked));
  }

  private async settled(): Promise<void> {
    while (this.work.size) await Promise.allSettled([...this.work]);
  }

  private offer(request: ChoiceRequest): void {
    this.track(
      (async () => {
        let items: ChoiceItem[];
        let note = request.note;
        if (Array.isArray(request.items)) items = request.items;
        else {
          try {
            const arrived = await request.items;
            items = arrived.items;
            note = arrived.note ?? note;
          } catch (error: any) {
            items = [];
            note = error?.message ?? String(error);
          }
        }
        // An answer given in advance was decided before the question was seen, so it is never the person's answer to one that is theirs.
        const given = items.length || request.freeText !== undefined ? (request.personOnly ? undefined : this.answers.shift()) : undefined;
        this.emit({
          kind: 'choice',
          title: request.title,
          items,
          ...(note ? { note } : {}),
          ...(request.hint ? { hint: request.hint } : {}),
          ...(request.freeText !== undefined ? { freeText: request.freeText } : {}),
          ...(request.personOnly ? { personOnly: true } : {}),
          answer: !items.length && request.freeText === undefined ? request.empty : given !== undefined ? `Answered in advance: ${given}.` : this.options.answerHint,
        });
        if (!items.length && request.freeText === undefined) return request.dismissed?.();
        if (given !== undefined) return this.answer({ request, items }, given);
        if (this.options.laterInput) {
          this.pending = { request, items };
          return;
        }
        this.emit({ kind: 'notice', level: 'info', text: `Nothing was chosen from "${request.title}": no answer was given for it.` });
        request.dismissed?.();
      })()
    );
  }

  private async answer(open: { request: ChoiceRequest; items: ChoiceItem[] }, given: string): Promise<void> {
    const text = given.trim();
    if (text.toLowerCase() === 'none') {
      this.emit({ kind: 'notice', level: 'info', text: `Closed "${open.request.title}" without a choice.` });
      return open.request.dismissed?.();
    }
    const number = /^\d+$/.test(text) ? Number(text) : undefined;
    const item =
      open.items.find((candidate) => candidate.key === text) ??
      (number !== undefined && number >= 1 && number <= open.items.length ? open.items[number - 1] : undefined) ??
      (open.request.freeText !== undefined && text ? { key: '__typed__', label: text, value: text } : undefined);
    if (!item) {
      const keys = open.items.map((candidate, index) => `${index + 1} (${candidate.key})`).join(', ');
      this.emit({ kind: 'notice', level: 'warn', text: `${text || 'Nothing'} is not one of the choices: ${keys}.` });
      if (this.options.laterInput) this.pending = open;
      else open.request.dismissed?.();
      return;
    }
    await open.request.choose(item);
  }

  private send(prompt: string, options: RunOptions & { display?: string } = {}): void {
    if (this.turn) return this.emit({ kind: 'notice', level: 'warn', text: 'A turn is running; wait for it to end.' });
    this.turn = true;
    this.track(
      this.options.runTurn(prompt, options).finally(() => {
        this.turn = false;
      })
    );
  }

  private context(): CommandContext {
    const host = this;
    const { options } = this;
    const notice = (level: NoticeLevel, text: string) => this.emit({ kind: 'notice', level, text });
    return {
      runtime: options.runtime,
      projectRoot: options.projectRoot,
      get running() {
        return host.turn;
      },
      show: (text, diff) => this.emit({ kind: 'output', text, ...(diff ? { diff } : {}) }),
      notice,
      event: (event) => this.emit({ kind: 'event', event }),
      working: () => undefined,
      refresh: () => options.onRefresh?.(),
      openSession: async () => options.openRefusal,
      opensSessions: false,
      setMode: (mode) => {
        const refusal = options.runtime.setPermissionMode(mode);
        if (refusal) return notice('warn', `Not switched to ${mode} mode: ${refusal}`);
        notice('info', `The mode is ${mode}.`);
        options.onMode?.(mode);
      },
      confirmBypass: () => notice('warn', BYPASS_HERE),
      copy: options.copy ?? (async () => false),
      exit: () => (options.onExit ? options.onExit() : notice('info', 'The session ends when this run does.')),
      commands: () => this.commands(),
      choose: (request) => this.offer(request),
      answerChoice: (given) => {
        const open = this.pending;
        if (!open) return notice('info', 'No list is waiting for an answer.');
        this.pending = undefined;
        this.track(this.answer(open, given));
      },
      themeName: loadConfig({ projectRoot: options.projectRoot }).config.ui?.theme ?? 'dark',
      setTheme: () => undefined,
      statusStyle: DEFAULT_STATUS_STYLE,
      setStatusStyle: () => undefined,
      note: (text) => {
        this.runtime.note(text);
        this.notes.unshift(text);
        this.emit({ kind: 'output', text: ['Tester notes, newest first, kept in the session log:', ...this.notes.map((line) => `- ${line}`)].join('\n') });
      },
      clearNotes: () => {
        this.notes.length = 0;
      },
      prefill: (text) => this.emit({ kind: 'prefill', text }),
      send: (prompt, turn) => this.send(prompt, turn),
      keyFor: () => undefined,
      keyHelp: () => undefined,
    };
  }
}

/** An entry as plain text, for a surface that shows text: headless output, or an ACP message. */
export function entryText(entry: Exclude<HostEntry, { kind: 'event' }>): string {
  switch (entry.kind) {
    case 'output':
      return entry.diff ? `${entry.text}\n\n\`\`\`diff\n${entry.diff.trimEnd()}\n\`\`\`` : entry.text;
    case 'notice':
      return entry.level === 'info' ? entry.text : `${entry.level === 'warn' ? 'Warning' : 'Error'}: ${entry.text}`;
    case 'prefill':
      return `To go on, edit and send: ${entry.text}`;
    case 'choice': {
      const lines = [entry.title];
      entry.items.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.label}${item.current ? ' (in use)' : ''}${item.detail ? ` · ${item.detail}` : ''}  [${item.key}]`);
      });
      if (entry.freeText !== undefined) lines.push(`  Or type an answer: ${entry.freeText}`);
      if (entry.note) lines.push('', entry.note);
      if (entry.personOnly) lines.push('', 'Only the person may answer this.');
      lines.push('', entry.answer);
      return lines.join('\n');
    }
  }
}
