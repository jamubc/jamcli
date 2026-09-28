import type { RunOptions, Runtime } from '../core/runtime/index.js';
import type { PermissionMode } from '../core/permissions/modes.js';
import type { AgentEvent } from '../core/types.js';
import type { StatusStyleDefinition } from '../styles/statusStyles.js';
import type { ThemeName } from '../types/config.js';
import type { Copier } from '../utils/clipboard.js';

/** Where a command comes from. The palette shows a custom command's source. */
export type CommandSource = 'built-in' | 'user' | 'project' | 'plugin' | 'mcp';

/** A session to open in place of the current one. */
export interface SessionChoice {
  /** Continue this session; a new one when absent. */
  sessionId?: string;
  /** Open it with this profile, for the rest of the surface's life. */
  profile?: string;
}

/** One choice a command offers. */
export interface ChoiceItem {
  key: string;
  label: string;
  /** A second column: facts about the choice. */
  detail?: string;
  /** The choice in effect now, marked as such. */
  current?: boolean;
  /** What choosing it gives, when that is more than the label shows. */
  value?: string;
}

/** A list a command offers to choose from: an overlay in the interface, a list answered with /choose elsewhere. */
export interface ChoiceRequest {
  title: string;
  /** The choices, or a promise of them while they are fetched. */
  items: ChoiceItem[] | Promise<{ items: ChoiceItem[]; note?: string }>;
  /** Said when there is nothing to choose. */
  empty: string;
  /** A line under the list, such as what Enter does. */
  hint?: string;
  /** A line above the hint: something to know, such as a provider that could not be asked. */
  note?: string;
  choose(item: ChoiceItem): void | Promise<void>;
  /**
   * Take what the person types as the answer: the first row is the typed text, labelled
   * with this, and the other choices are shown whole rather than filtered.
   */
  freeText?: string;
  /** Called when the list closes without a choice. */
  dismissed?(): void;
  /** The key of the row the list opens on, when not the one in use. */
  at?: string;
  /** Only the person may answer it, such as whether to trust a project's hooks. */
  personOnly?: boolean;
}

export type { Copier } from '../utils/clipboard.js';

export type NoticeLevel = 'info' | 'warn' | 'error';

/**
 * What a command may do. Every surface supplies it: the interface, headless invocation,
 * ACP, and the driver. What only a terminal can do, such as repainting in a new theme, is a
 * member a surface without one implements as nothing; the rest of the command runs everywhere.
 */
export interface CommandContext {
  readonly runtime: Runtime;
  readonly projectRoot: string;
  /** Whether a turn is running. Commands that change the session wait for it to end. */
  readonly running: boolean;
  /** The profile chosen with /profile, when one was; otherwise the configured one applies. */
  readonly profile?: string;
  /** Add what the command reports, with a diff to show beside it when there is one. */
  show(text: string, diff?: string): void;
  notice(level: NoticeLevel, text: string): void;
  /** A runtime event the command caused outside a turn, as a compaction's. */
  event(event: AgentEvent): void;
  /** What the session is doing while the command works, for the status line. */
  working(phase: 'compacting' | 'idle'): void;
  /** Read the status line's facts from the runtime again. */
  refresh(): void;
  /** Close this session and open another. Resolves to why not, when it could not. */
  openSession(choice: SessionChoice): Promise<string | undefined>;
  /** Whether this surface replaces its session in place: the interface does, while headless and ACP keep theirs. */
  readonly opensSessions: boolean;
  setMode(mode: PermissionMode): void;
  /** Ask the person to confirm bypass mode. */
  confirmBypass(): void;
  copy: Copier;
  /** Leave: the interface closes, and another surface ends the session. */
  exit(): void;
  /** Every command, for /help. */
  commands(): SlashCommand[];
  /** Offer a list to choose from. */
  choose(request: ChoiceRequest): void;
  /** Answer the list a command offered, as /choose does where there is no screen to choose on. */
  answerChoice(answer: string): void;
  /** The theme in use. */
  readonly themeName: ThemeName;
  /** Repaint in a theme, where there is a screen. */
  setTheme(name: ThemeName): void;
  /** The working indicator's style. */
  readonly statusStyle: StatusStyleDefinition;
  setStatusStyle(style: StatusStyleDefinition): void;
  /** Pin a sticky note, newest on top. Notes never reach the model. */
  note(text: string): void;
  clearNotes(): void;
  /**
   * A command line for the person to finish, such as a commit message to edit. With
   * `back`, taking it back out unsent runs `back`, such as reopening the list it came from.
   */
  prefill(text: string, back?: () => void): void;
  /** Send a prompt as a turn, showing `display` as what was typed, as a custom command does. */
  send(prompt: string, options?: RunOptions & { display?: string }): void;
  /** The key bound to an action, such as `cycle_mode`, where there are keys. */
  keyFor(action: string): string | undefined;
  /** Every key and what it does, for /help, where there are keys. */
  keyHelp(): string | undefined;
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
