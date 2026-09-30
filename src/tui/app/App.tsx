/** @jsxImportSource @opentui/react */
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { adoptOrphanDraft, clearDraft, debugTranscript, saveDraft } from '../../core/transcript/index.js';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import { fitPhrase, isMicro, microPhrase, microSetting } from './micro.js';
import { decodePasteBytes, stripAnsiSequences, type PasteEvent, type ScrollBoxRenderable, type TextareaRenderable } from '@opentui/core';
import type { Runtime } from '../../core/runtime/index.js';
import { anchorsToTop, initialView, reduceView, type ViewState } from '../state/view.js';
import { SessionController, statusOf, gitBranch } from './controller.js';
import { PHASE_WORDS, fitStatus, phaseWord, statusParts, thinkingSize, wrapWithin } from './format.js';
import { Indicator } from './Indicator.js';
import { DEFAULT_STATUS_STYLE, type StatusStyleDefinition } from '../../styles/statusStyles.js';
import { createSyntaxStyle } from './syntax.js';
import { BUILTIN_COMMANDS } from '../../commands/builtin/index.js';
import { findCommand, matchCommands, parseCommand } from '../../commands/parse.js';
import type { ChoiceItem, ChoiceRequest, CommandContext, SessionChoice, SlashCommand } from '../../commands/types.js';
import { customCommands, slashCommandForPrompt } from '../../commands/custom.js';
import { askToTrustHooks } from '../../commands/builtin/extensions.js';
import { answerElicitation } from './elicit.js';
import { Palette, ReferencePalette } from './Palette.js';
import { completeReference, matchReferences, referenceCandidates, referenceToken, type ReferenceItem } from './references.js';
import { noteCall, noteText } from './note.js';
import { Picker, shownItems, PICKER_ROWS } from './Picker.js';
import { MotionContext, PlainContext, THEMES, ThemeContext, chosenRow, framed, resolveTheme, selectable, useReducedMotion, useTheme, type Theme } from './theme.js';
import { KEY_ACTIONS, keysFor, keysHelp, loadKeybindings, matchesAction, type KeyAction, type KeyLike, type Keybindings } from './keys.js';
import { earlierMessages } from './history.js';
import { chipAt, chipLabel, expandChips, isLarge, nextChipId, normalizeNewlines, type Chips } from './paste.js';
import { cursorLines, describeRecall, isRecalled, recallDown, recallEscape, recallUp, type Move, type Recall } from './recall.js';
import type { Phase, TodoView } from '../state/view.js';
import type { WorkItem } from '../../core/work.js';
import type { SessionNote } from '../../core/runtime/index.js';
import type { AgentEvent } from '../../core/types.js';
import { formatTokens, formatUsd } from '../../core/catalog/cost.js';
import { useClickable } from './mouse.js';
import type { SyntaxStyle } from '@opentui/core';
import type { ThinkingSize } from './format.js';
import { Rail, RowView } from './Rows.js';
import { BypassConfirm, PermissionPrompt } from './Prompt.js';
import { systemCopier, type Copier } from './clipboard.js';
import type { ObserverHub } from '../observer.js';

export interface AppProps {
  /** The session the interface opens on. */
  runtime: Runtime;
  projectRoot: string;
  /** Called when the person asks to leave. */
  onExit: () => void;
  /** Open a session in place of the current one: a new one, or `sessionId`, with the chosen profile. */
  openSession: (choice: SessionChoice) => Promise<Runtime>;
  /** Commands beyond the built-in ones, such as custom commands. */
  commands?: SlashCommand[];
  /** The theme to start with, resolved from `ui.theme` and NO_COLOR. Defaults to dark. */
  theme?: Theme;
  /** Plain labeled lines with no boxes or marks, from `--screen-reader` or `ui.screen_reader`. */
  screenReader?: boolean;
  /** No spinner or shimmer, from `ui.reduced_motion`, and always in screen reader mode. */
  reducedMotion?: boolean;
  /** How large the live thinking window is drawn, from `ui.thinking_lines` and `ui.thinking_width`. */
  thinking?: { lines?: number; width?: number };
  /** The keys, with what was wrong in the keybindings file. Read from the user's file when absent. */
  keys?: { bindings: Keybindings; problems: string[] };
  /** No user configuration and no model: open setup at the start. */
  firstRun?: boolean;
  /** The working indicator's spinner and colors. Defaults to the classic spinner with subtle words. */
  statusStyle?: StatusStyleDefinition;
  /** Micro status mode: `auto` below 11 rows or 41 columns, `always`, or `never`. Defaults to `JAMCLI_MICRO`, then `auto`. */
  micro?: 'auto' | 'always' | 'never';
  /** Hears every event and each session opened, for the ACP observer endpoint. */
  observer?: Pick<ObserverHub, 'event' | 'attach'>;
  /** Where copied text goes. Defaults to the system clipboard, then the terminal's. */
  copy?: Copier;
}

/** The most rows the running step takes on the board, its check included. */
const STEP_LINES = 4;

/** The most characters of what a child is doing now that its row shows. */
const DOING_WIDTH = 28;
const cut = (text: string, room: number): string => (text.length > room ? `${text.slice(0, Math.max(1, room - 1))}…` : text);
const fitDoing = (detail: string): string => cut(detail, DOING_WIDTH);

/** The most lines the composer grows to before it scrolls. */
const COMPOSER_LINES = 8;

/** How long the draft in the composer may go unwritten while the person types. */
const DRAFT_SAVE_MS = 250;

/** How long a short confirmation, such as a copy, stays on the status line. */
const FLASH_MS = 2_200;

/**
 * # of transcript rows
 */
export const TRANSCRIPT_ROWS = 200;

/** How long the view holds its place while earlier rows are laid out. */
const ANCHOR_MS = 600;

const WORKING = new Set<Phase>(['thinking', 'streaming', 'tool', 'retrying', 'compacting']);

/** A step's state as screen reader mode reads it, and as the styled board draws it. */
const TODO_BOXES: Record<TodoView['status'], string> = { pending: '[ ]', in_progress: '[~]', completed: '[x]' };
const TODO_MARKS: Record<TodoView['status'], string> = { pending: '○', in_progress: '◐', completed: '●' };

/** One line of the checklist, in words, as screen reader mode reads it. */
export const todoLine = (todo: TodoView): string =>
  `${TODO_BOXES[todo.status]} ${todo.status === 'in_progress' && todo.active_form ? todo.active_form : todo.content}${todo.check ? `\n    check: ${todo.check}` : ''}`;

/** How long something has run, in the words a glance takes. */
const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
};

/** How long an ended child stays on the board, so its end is seen and it can still be opened. */
const RECENT_WORK_MS = 90_000;

/**
 * The work the board lists: what runs, and what ended a moment ago. A child that ended
 * before the person's last message is behind them and leaves the board.
 */
export const shownWork = (work: WorkItem[], now: number, sentAt = 0): WorkItem[] =>
  work.filter((item) => item.endedAt === undefined || (item.endedAt >= sentAt && now - item.endedAt < RECENT_WORK_MS));

/** A child's facts in one dim run: how long, how many tokens, what it cost. */
const workFacts = (item: WorkItem, now: number): string[] => [
  elapsed((item.endedAt ?? now) - item.startedAt),
  ...(item.tokens ? [`${formatTokens(item.tokens)} tokens`] : []),
  ...(item.cost ? [formatUsd(item.cost)] : []),
];

/** The mark and color of a work item's state. */
const workState = (item: WorkItem, colors: Theme): { mark: string; color: Theme['accent'] } => {
  if (item.endedAt === undefined) return { mark: '◐', color: colors.warn };
  return item.outcome === 'ok' ? { mark: '●', color: colors.user } : { mark: '●', color: colors.error };
};

/** A step's mark in its own color: done is green, running is yellow, waiting is dim. */
const todoColor = (status: TodoView['status'], colors: Theme) => (status === 'completed' ? colors.user : status === 'in_progress' ? colors.warn : colors.dim);

/**
 * The model's plan as a board, above the composer: shown on its own when a list first
 * arrives or a child starts, hidden and shown with the todos key, and kept in place while a
 * prompt is up. The header is the whole plan in marks, each in the color of its state, and
 * the count. Under it, each child agent that runs beside the turn: its state, its agent
 * and task, how long it has run and what it has cost, and below that, behind a rail, what
 * it is doing right now. Then each step, indented, with its state as a mark and a color.
 * Up and Down on an empty composer choose a child, Enter looks in on it, and a click does
 * both. Screen reader mode reads the same facts as lines of words.
 */
function TodoPanel({
  todos,
  plan,
  phase,
  plain,
  colors,
  focus,
  listed,
  pinned,
  onOpen,
}: {
  todos: TodoView[] | undefined;
  plan: ViewState['plan'];
  phase: Phase;
  plain: boolean;
  colors: Theme;
  /** The child the keys chose, by its id. */
  focus?: string;
  /** The work the board lists: what runs, and what ended a moment ago and since the last message. The keys walk this same list. */
  listed: WorkItem[];
  /** Opened with the todos key, so it stays up with nothing to list. */
  pinned: boolean;
  onOpen: (id: string) => void;
}) {
  const sel = selectable(colors);
  const reduced = useReducedMotion();
  const clickable = useClickable();
  // The room a step's words have: the board's padding, the step's indent, and its mark.
  const columns = useTerminalDimensions().width;
  const stepWidth = Math.max(10, columns - 7);
  // An agent's row: the board's padding on both sides and the row's own indent.
  const rowWidth = Math.max(20, columns - 4);
  const done = todos?.filter((todo) => todo.status === 'completed').length ?? 0;
  const running = todos?.find((todo) => todo.status === 'in_progress');
  const [now, setNow] = useState(Date.now());
  const live = listed.filter((item) => item.endedAt === undefined);
  const ended = listed.length - live.length;
  // The clock ticks only while something has a duration to show, and never in screen reader mode or with reduced motion.
  const ticking = !plain && !reduced && (running?.since !== undefined || listed.length > 0);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [ticking]);
  const words = phase === 'idle' ? '' : PHASE_WORDS[phase];
  const kindOf = (item: WorkItem) => (item.kind === 'job' ? 'command' : (item.agent ?? 'agent'));
  // A board that came up on its own goes again once it has nothing left to show.
  if (!pinned && !todos?.length && !listed.length) return null;
  if (plain) {
    return (
      <box flexDirection="column" flexShrink={0}>
        <text {...sel}>{`${todos?.length ? `Plan: ${done} of ${todos.length} done` : 'Plan'}${words ? `, ${words}` : ''}${plan ? `, saved at ${plan.path}, edit it there to steer the model` : ''}`}</text>
        {listed.map((item) => (
          <text {...sel} key={item.id}>
            {`${item.endedAt === undefined ? 'Running' : `Ended ${item.outcome ?? ''}`}: ${item.kind === 'job' ? 'command' : `agent ${item.agent ?? ''}`} ${item.label}, ${workFacts(item, now).join(', ')}${item.detail ? `, now: ${item.detail}` : ''}${item.endedAt === undefined ? `, stop it with /jobs stop ${item.id}` : ''}${item.id === focus ? ', chosen, Enter looks in on it' : ''}`}
          </text>
        ))}
        {todos?.length ? todos.map((todo, index) => <text {...sel} key={index}>{todoLine(todo)}</text>) : listed.length ? null : <text {...sel}>No checklist yet. The model writes one with todo_write as it works.</text>}
      </box>
    );
  }
  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1} paddingTop={1}>
      <text {...sel} fg={colors.accent} wrapMode="none" truncate>
        {todos?.length ? 'Plan ' : listed.length ? 'Agents ' : 'Plan'}
        {todos?.map((todo, index) => (
          <span key={index} fg={todoColor(todo.status, colors)}>{`${TODO_MARKS[todo.status]} `}</span>
        ))}
        {todos?.length ? (
          <span fg={colors.text}>{`${done} of ${todos.length}`}</span>
        ) : listed.length ? (
          <span fg={colors.text}>{[live.length ? `${live.length} running` : '', ended ? `${ended} done` : ''].filter(Boolean).join(', ')}</span>
        ) : null}
        <span fg={colors.dim}>{`${words && todos?.length ? ` · ${words}` : ''}${plan ? ` · ${plan.path}` : ''}${listed.some((item) => item.kind === 'task') && !focus ? ' · ↓ choose an agent, Enter looks in' : ''}`}</span>
      </text>
      {listed.map((item) => {
        const state = workState(item, colors);
        const chosen = item.id === focus;
        const bar = chosenRow(colors, chosen);
        // What a running child is doing right now is cut to a few words, so its label and its facts keep the room.
        const doing = item.kind === 'task' && item.endedAt === undefined ? fitDoing(item.detail ?? 'starting') : undefined;
        const asking = doing !== undefined && item.detail?.startsWith('asking') === true;
        const rest = [...workFacts(item, now), ...(item.endedAt !== undefined ? [item.outcome ?? 'ended'] : item.kind === 'job' ? [`/jobs stop ${item.id}`] : []), ...(chosen ? ['Enter looks in'] : [])].join(' · ');
        // One row: the state, the agent, and its label at the left, cut first; what it does now and its facts at the right, never cut.
        const right = (doing !== undefined ? doing.length + 3 : 0) + rest.length;
        // The label has what the row leaves after its mark, its agent, its facts, and a gap of two; a longer one ends in an ellipsis.
        const label = cut(item.label, rowWidth - 2 - kindOf(item).length - 1 - right - 2 - 1);
        return (
          <box key={item.id} flexDirection="row" justifyContent="space-between" flexShrink={0} paddingLeft={2} {...(bar.bg ? { backgroundColor: bar.bg } : {})} {...clickable(() => onOpen(item.id))}>
            <text {...sel} wrapMode="none" truncate flexShrink={1} {...(bar.attributes !== undefined ? { attributes: bar.attributes } : {})}>
              <span fg={state.color}>{`${state.mark} `}</span>
              <span fg={colors.accent}>{kindOf(item)}</span>
              <span fg={colors.text}>{` ${label}`}</span>
            </text>
            <text {...sel} wrapMode="none" flexShrink={0} marginLeft={2} {...(bar.attributes !== undefined ? { attributes: bar.attributes } : {})}>
              {doing !== undefined ? <span fg={asking ? colors.warn : colors.dim}>{`${doing} · `}</span> : null}
              <span fg={colors.dim}>{rest}</span>
            </text>
          </box>
        );
      })}
      {todos?.length ? (
        <box flexDirection="column" flexShrink={0} marginTop={listed.length ? 1 : 0} paddingLeft={2}>
          {todos.map((todo, index) => {
            const active = todo.status === 'in_progress';
            const color = todo.status === 'completed' ? colors.settled : active ? colors.text : colors.dim;
            const label = active && todo.active_form ? todo.active_form : todo.content;
            const clock = active && todo.since !== undefined ? ` · ${elapsed(now - todo.since)}` : '';
            // The running step wraps to a few rows, its check taking one of them; every other step is a row cut where it runs out.
            const lines = active ? wrapWithin(label, stepWidth - clock.length, todo.check ? STEP_LINES - 1 : STEP_LINES) : [label];
            return (
              <box key={index} flexDirection="column" flexShrink={0}>
                {lines.map((line, at) => (
                  <text {...sel} key={at} wrapMode="none" truncate>
                    <span fg={todoColor(todo.status, colors)}>{at === 0 ? `${TODO_MARKS[todo.status]} ` : '  '}</span>
                    <span fg={color}>{line}</span>
                    {at === lines.length - 1 && clock ? <span fg={colors.dim}>{clock}</span> : null}
                  </text>
                ))}
                {active && todo.check ? (
                  <Rail>
                    <text {...sel} fg={colors.dim} wrapMode="none" truncate>{`check: ${todo.check}`}</text>
                  </Rail>
                ) : null}
              </box>
            );
          })}
        </box>
      ) : listed.length ? null : (
        <text {...sel} fg={colors.dim}>No checklist yet. The model writes one with todo_write as it works.</text>
      )}
    </box>
  );
}

/** A note's time, as the clock on the wall read it. */
const noteClock = (ts: number): string => {
  const at = new Date(ts);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
};

/**
 * The tester's flags, newest on top, shown while there are any. A flag is a person's
 * remark on this point of the session, for whoever reads it back; the model never sees
 * it, and the session log keeps it.
 */
function NotesPanel({ notes, plain, colors }: { notes: SessionNote[]; plain: boolean; colors: Theme }) {
  const sel = selectable(colors);
  if (plain) {
    return (
      <box flexDirection="column" flexShrink={0}>
        {notes.map((note, index) => (
          <text {...sel} key={notes.length - index}>{`Tester note at ${noteClock(note.ts)}: ${note.text}`}</text>
        ))}
      </box>
    );
  }
  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
      {notes.map((note, index) => (
        <text {...sel} key={notes.length - index} wrapMode="word">
          <span fg={colors.warn}>{'⚑ '}</span>
          <span fg={colors.dim}>{`${noteClock(note.ts)} `}</span>
          <span fg={index === 0 ? colors.text : colors.dim}>{note.text}</span>
        </text>
      ))}
    </box>
  );
}

/**
 * A child agent's run as a transcript of its own, in place of the conversation: what it
 * has done so far, folded from its events, and each further event as it happens. Escape
 * returns to the conversation; s stops the child; once it has ended, o opens its session.
 */
function AgentViewer({ runtime, item, syntax, thinking, focus }: { runtime: Runtime; item: WorkItem; syntax: SyntaxStyle; thinking: ThinkingSize; focus?: (box: ScrollBoxRenderable | null) => void }) {
  const theme = useTheme();
  const sel = selectable(theme);
  const seen = useRef(0);
  const [child, fold] = useReducer(reduceView, undefined, (): ViewState => {
    const events = runtime.workEvents(item.id);
    seen.current = events.length;
    return events.reduce((state, event) => reduceView(state, { type: 'event', event }), initialView());
  });
  useEffect(() => {
    // Events between the first fold and now are taken before the watch starts, so none is missed.
    for (const event of runtime.workEvents(item.id).slice(seen.current)) fold({ type: 'event', event });
    return runtime.watchWorkEvents(item.id, (event: AgentEvent) => fold({ type: 'event', event }));
  }, [runtime, item.id]);
  const state = workState(item, theme);
  const facts = workFacts(item, Date.now());
  const running = item.endedAt === undefined;
  const keys = running ? 'Esc back · ↑↓ scroll · type below to talk to it, /stop stops it' : `Esc back${item.sessionId ? ' · o opens its session to go on with it' : ''} · ↑↓ scroll`;
  /** A line typed to the child: `/stop` stops it; anything else it reads with its next step. */
  const sayTo = (value: unknown) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return;
    if (text === '/stop') return void runtime.stopWork(item.id);
    if (!runtime.sayToWork(item.id, text)) fold({ type: 'notice', level: 'warn', text: 'It has ended, so it cannot hear you. o opens its session to go on with it.' });
  };
  return (
    <box flexDirection="column" flexGrow={1}>
      <text {...sel} wrapMode="none" truncate flexShrink={0}>
        <span fg={state.color}>{`${state.mark} `}</span>
        <span fg={theme.accent}>{item.agent ?? 'agent'}</span>
        <span fg={theme.text}>{` ${item.label}`}</span>
        <span fg={theme.dim}>{` · ${[...facts, item.model, item.endedAt !== undefined ? (item.outcome ?? 'ended') : undefined].filter(Boolean).join(' · ')}`}</span>
      </text>
      <text {...sel} fg={theme.dim} flexShrink={0}>{keys}</text>
      {child.rows.length ? null : <text {...sel} fg={theme.dim} flexShrink={0}>{item.endedAt === undefined ? 'Nothing yet: the child is waiting for its model.' : 'It said nothing before it ended.'}</text>}
      <scrollbox ref={focus} flexGrow={1} stickyScroll stickyStart="bottom" viewportCulling contentOptions={{ paddingRight: 1 }}>
        {child.rows.map((row) => (
          <RowView key={row.id} row={row} syntax={syntax} thinking={thinking} open />
        ))}
      </scrollbox>
      {running ? (
        <box {...framed(false, theme.border)} flexShrink={0} height={3}>
          <input key={item.id} focused placeholder={`Message ${item.agent ?? 'the agent'} · it reads it after its current step · /stop stops it`} onSubmit={sayTo} />
        </box>
      ) : null}
    </box>
  );
}

/** How long the Esc badge shows red before a denied prompt goes. */
const ESC_FLASH_MS = 150;

/** The pattern a prompt offers, by its place among the suggestions, and whether it is taking feedback. */
interface PromptSelection {
  callId?: string;
  selected: number;
  feedback: boolean;
}

/** A composer line that starts with a slash and has no space yet is a command being named. */
const naming = (draft: string) => draft.startsWith('/') && !/\s/.test(draft);

export function App(props: AppProps) {
  const { runtime: first, projectRoot, onExit, openSession: open, commands: extra = [], theme: startTheme = THEMES.dark, screenReader = false } = props;
  // Tiled too small to read, the interface shows one static phrase; the full view stays
  // mounted underneath, hidden, so restoring the size restores it as it was.
  const size = useTerminalDimensions();
  const micro = isMicro(props.micro ?? microSetting(process.env.JAMCLI_MICRO), size);
  const reducedMotion = screenReader || Boolean(props.reducedMotion) || micro;
  // The thinking window keeps the size it is given, narrowed only when the terminal is narrower.
  const thinking = useMemo(() => thinkingSize(props.thinking, Math.max(1, size.width - 2)), [props.thinking, size.width]);
  const keys = useMemo(() => props.keys ?? loadKeybindings(), [props.keys]);
  const bound = (action: KeyAction, key: KeyLike) => matchesAction(keys.bindings, action, key);
  // Hidden, up on its own because a checklist or a child appeared, or pinned with the todos key.
  const [board, setBoard] = useState<'hidden' | 'auto' | 'pinned'>('hidden');
  /** When the person last sent a message, which retires the children that ended before it. */
  const [sentAt, setSentAt] = useState(0);
  const renderer = useRenderer();
  // A session opened with messages already in it shows them from the first frame.
  const [state, dispatch] = useReducer(reduceView, undefined, (): ViewState =>
    // The status line has the session's facts from the first frame, not after an effect.
    reduceView(initialView(statusOf(first)), { type: 'load', messages: first.session.messages, notes: first.notes() })
  );
  // What the board lists and what the keys walk are one list, from one clock. The clock runs while
  // any child has ended, since its minute and a half on the board is up whether or not motion is reduced.
  const [boardClock, setBoardClock] = useState(Date.now());
  const anyEnded = state.work.some((item) => item.endedAt !== undefined);
  useEffect(() => {
    if (!anyEnded) return;
    setBoardClock(Date.now());
    const timer = setInterval(() => setBoardClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [anyEnded]);
  const listedWork = useMemo(() => shownWork(state.work, boardClock, sentAt), [state.work, boardClock, sentAt]);
  // A checklist that has just appeared, or a child agent that has just started, is shown without asking; the todos key hides the board again.
  const hasTodos = Boolean(state.todos?.length);
  const liveAgents = state.work.filter((item) => item.endedAt === undefined && item.kind === 'task').length;
  useEffect(() => {
    if (hasTodos || liveAgents) setBoard((shown) => (shown === 'hidden' ? 'auto' : shown));
  }, [hasTodos, liveAgents > 0]);
  const [runtime, setRuntime] = useState(first);
  const controller = useMemo(() => new SessionController(runtime, dispatch, props.observer?.event), [runtime]);
  useEffect(() => props.observer?.attach(runtime), [runtime]);
  // What runs beside the turn reaches the status line between turns too.
  useEffect(() => controller.watchWork(), [controller]);
  // Custom commands are read again with each session, so a file added meanwhile is found.
  const custom = useMemo(() => customCommands(projectRoot, BUILTIN_COMMANDS), [projectRoot, runtime]);
  // MCP prompts arrive once the servers answer; the palette gains them then.
  const [promptCommands, setPromptCommands] = useState<SlashCommand[]>([]);
  useEffect(() => {
    let current = true;
    setPromptCommands([]);
    runtime.mcpPrompts().then(
      (prompts) => current && setPromptCommands(prompts.map(slashCommandForPrompt).filter((command) => !BUILTIN_COMMANDS.some((builtIn) => builtIn.name === command.name))),
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [runtime]);
  const commands = useMemo(() => [...BUILTIN_COMMANDS, ...custom.commands, ...promptCommands, ...extra], [custom, promptCommands, extra]);
  const composer = useRef<TextareaRenderable | null>(null);
  const transcript = useRef<ScrollBoxRenderable | null>(null);
  /** How many of the latest rows are drawn; it starts over with each session. */
  const [drawn, setDrawn] = useState(TRANSCRIPT_ROWS);
  /**
   * Where the view was when earlier rows were asked for, as the distance from its top to
   * the bottom, which rows added above do not change. Until the new rows have their
   * heights (Markdown takes a frame or more), each frame puts the view back there, so
   * the row that was at the top stays there. The next page key lets go.
   */
  const anchor = useRef<{ fromBottom: number; until: number } | undefined>(undefined);
  /** Set by the first exit key and read by the second, which may arrive before the screen is drawn again, so it is not state. */
  const exitArmed = useRef(false);
  const branch = useMemo(() => gitBranch(runtime.workRoot), [runtime.workRoot]);
  const [theme, setTheme] = useState<Theme>(startTheme);
  const sel = selectable(theme);
  const [statusStyle, setStatusStyle] = useState<StatusStyleDefinition>(props.statusStyle ?? DEFAULT_STATUS_STYLE);
  /** The phase the indicator last showed, and how many phases have begun, which picks a style's word for each. */
  const phases = useRef<{ phase: Phase; count: number }>({ phase: 'idle', count: 0 });
  const syntax = useMemo(() => createSyntaxStyle(theme), [theme]);
  useEffect(() => () => syntax.destroy(), [syntax]);

  /** Notices already on screen: a session reopened, as a settings change does, does not repeat them. */
  const noticed = useRef(new Set<string>());
  useEffect(() => {
    controller.refresh();
    // Taken here, so the first turn does not report them a second time.
    for (const notice of new Set([...runtime.notices, ...runtime.takeNotices()])) {
      if (noticed.current.has(notice)) continue;
      noticed.current.add(notice);
      dispatch({ type: 'notice', level: 'warn', text: notice });
    }
  }, [controller, runtime]);
  useEffect(() => {
    for (const problem of keys.problems) dispatch({ type: 'notice', level: 'warn', text: problem });
  }, [keys]);
  useEffect(() => {
    for (const problem of custom.problems) dispatch({ type: 'notice', level: 'warn', text: problem });
  }, [custom]);

  // Another session starts at its latest rows, at the bottom, wherever this one was.
  useEffect(() => {
    setDrawn(TRANSCRIPT_ROWS);
    anchor.current = { fromBottom: 0, until: Date.now() + ANCHOR_MS };
  }, [runtime]);
  useEffect(() => {
    const keep = () => {
      const box = transcript.current;
      const held = anchor.current;
      if (!box || !held) return;
      if (Date.now() > held.until) anchor.current = undefined;
      const target = Math.max(0, box.scrollHeight - held.fromBottom);
      if (box.scrollTop !== target) {
        box.scrollTop = target;
        renderer.requestRender();
      }
    };
    renderer.addPostProcessFn(keep);
    return () => renderer.removePostProcessFn(keep);
  }, [renderer]);
  const hidden = Math.max(0, state.rows.length - drawn);
  const lastRow = state.rows[state.rows.length - 1];
  // A report (e.g. /tools) taller than the viewport would otherwise open scrolled to its
  // bottom under stickyStart="bottom", hiding its first line. Anchor to the row's own top
  // instead when it alone exceeds what the viewport can show.
  useEffect(() => {
    const box = transcript.current;
    if (!box || !lastRow || lastRow.kind !== 'output') return;
    const rowLines = lastRow.text.split('\n').length;
    if (anchorsToTop(rowLines, box.height)) {
      anchor.current = { fromBottom: rowLines, until: Date.now() + ANCHOR_MS };
    }
  }, [lastRow]);

  /** A short confirmation on the status line, such as what a selection copied. */
  const [flash, setFlash] = useState<string | undefined>(undefined);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flashFor = (text: string) => {
    setFlash(text);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(undefined), FLASH_MS);
  };
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const ownCopier = useMemo(() => (props.copy ? undefined : systemCopier(renderer)), [renderer, props.copy]);
  useEffect(() => () => ownCopier?.dispose(), [ownCopier]);
  const copyText: Copier = props.copy ?? ownCopier!.copy;
  const copyRef = useRef(copyText);
  copyRef.current = copyText;
  // Releasing a drag copies what it selected, as a terminal does; the selection stays
  // marked until the next click.
  useEffect(() => {
    const copySelection = (selection: { getSelectedText(): string } | null) => {
      const text = selection?.getSelectedText() ?? '';
      if (!text.trim()) return;
      void copyRef.current(text).then((how) =>
        flashFor(how ? `Copied ${text.length.toLocaleString('en-US')} character${text.length === 1 ? '' : 's'}${how === 'terminal' ? ' through the terminal' : ''}` : 'This terminal cannot take text for the clipboard')
      );
    };
    renderer.on('selection', copySelection);
    return () => {
      renderer.off('selection', copySelection);
    };
  }, [renderer]);
  /**
   * A selection started in the transcript keeps scrolling it while the pointer is dragged
   * above or below it, over the header or the composer, so a long reply can be selected
   * whole. The transcript scrolls itself while the pointer is on its edge rows.
   */
  const selectingTranscript = useRef(false);
  const dragPast = (event: { x: number; y: number }) => {
    const box = transcript.current;
    if (!selectingTranscript.current || !box) return;
    const bottom = box.y + box.height - 1;
    if (event.y < box.y || event.y > bottom) box.updateAutoScroll(event.x, Math.min(Math.max(event.y, box.y), bottom));
  };
  /**
   * A press in the transcript starts a selection and leaves the keyboard where it was. The
   * renderer focuses whatever a press lands in, and the transcript's scrollbox can be focused,
   * which would take typing from the composer until it was clicked.
   */
  const keepComposerFocus = (event: { preventDefault: () => void }) => {
    selectingTranscript.current = true;
    event.preventDefault();
  };
  const endDrag = () => {
    if (!selectingTranscript.current) return;
    selectingTranscript.current = false;
    transcript.current?.stopAutoScroll();
  };

  /**
   * The detailed transcript: the conversation's own rows with every block open, in place of
   * the composer until it is closed, for reading the session back. A click hides a block
   * there without touching the conversation, whose blocks stay as they were. It holds the
   * rows closed in it. The composer stays mounted underneath, so a draft survives it, and
   * the whole log, for debugging, is `v` or `/copy debug`.
   */
  const [viewer, setViewer] = useState<ReadonlySet<number> | undefined>(undefined);
  const [viewerHelp, setViewerHelp] = useState(false);
  const openViewer = () => {
    if (!state.rows.length) return dispatch({ type: 'notice', level: 'info', text: 'Nothing to show yet: the transcript starts with the first message.' });
    composer.current?.blur();
    setViewerHelp(false);
    setViewer(new Set());
  };
  const toggleInViewer = (id: number) =>
    setViewer((closed) => {
      if (!closed) return closed;
      const next = new Set(closed);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const closeViewer = () => {
    setViewer(undefined);
    if (!overlay.current) composer.current?.focus();
  };
  /**
   * Looking in on a child agent: the one the keys chose on the board, by id, and the one
   * whose run is shown in place of the conversation. Up and Down on an empty composer
   * choose, Enter or a click opens, Escape returns.
   */
  const [agentFocus, setAgentFocusState] = useState<string | undefined>(undefined);
  // Keys read the ref, which changes at once: two Downs arriving together move two rows, not one.
  const agentFocusRef = useRef<string | undefined>(undefined);
  const setAgentFocus = (id: string | undefined) => {
    agentFocusRef.current = id;
    setAgentFocusState(id);
  };
  const [agentView, setAgentView] = useState<string | undefined>(undefined);
  const agentBox = useRef<ScrollBoxRenderable | null>(null);
  const viewedAgent = agentView ? state.work.find((item) => item.id === agentView) : undefined;
  // A child that left the board is no longer chosen, and one that was forgotten closes its view.
  useEffect(() => {
    // A child that left the board, by the time or by the next message, is no longer the one chosen.
    if (agentFocus && !listedWork.some((item) => item.id === agentFocus)) setAgentFocus(undefined);
    if (agentView && !viewedAgent) setAgentView(undefined);
  }, [state.work, listedWork]);
  const openAgent = (id: string) => {
    if (!state.work.some((item) => item.id === id)) return;
    composer.current?.blur();
    setAgentFocus(id);
    setAgentView(id);
  };
  const closeAgent = () => {
    setAgentView(undefined);
    if (!overlay.current && !viewer) composer.current?.focus();
  };

  /** The whole session log, as `/copy debug` renders it, written beside the log and opened in VS Code. */
  const openLogInCode = () => {
    const log = debugTranscript(projectRoot, runtime.sessionId);
    if (!log) return dispatch({ type: 'notice', level: 'info', text: 'Nothing is recorded yet: the log starts with the first message.' });
    const target = log.file.replace(/\.jsonl$/, '.debug.md');
    fs.writeFileSync(target, log.text, 'utf8');
    const child = spawn('code', [target], { detached: true, stdio: 'ignore' });
    child.on('error', (error: NodeJS.ErrnoException) =>
      dispatch({ type: 'notice', level: 'warn', text: error.code === 'ENOENT' ? `The code command is not on PATH, so the transcript was not opened. It is ${path.relative(projectRoot, target)}.` : `Could not open ${path.relative(projectRoot, target)} in code: ${error.message}` })
    );
    child.unref();
    flashFor(`Opening ${path.relative(projectRoot, target)} in code`);
  };

  const approval = state.approvals[0];
  // Asks for the same call are one prompt: its answer settles them all, and the count of prompts counts it once.
  const asking = approval?.key ? state.approvals.filter((item) => item.key === approval.key) : approval ? [approval] : [];
  const prompts = new Set(state.approvals.map((item) => item.key ?? item.callId)).size;
  /**
   * Which suggested pattern the prompt offers, and whether it is taking feedback, for the
   * call it was chosen on. A new call starts over without an effect, so a key pressed as
   * the prompt appears is never undone by a reset that runs after it. Keys read the ref,
   * which changes at once: Up then 2, arriving together, grant the pattern Up chose.
   */
  const [, setChoice] = useState<PromptSelection>({ selected: 0, feedback: false });
  /** Escape was pressed on the prompt, and the answer is on its way. */
  const [escaping, setEscaping] = useState(false);
  useEffect(() => {
    if (!approval) setEscaping(false);
  }, [approval]);
  const choice = useRef<PromptSelection>({ selected: 0, feedback: false });
  const selection = (): PromptSelection => (approval && choice.current.callId === approval.callId ? choice.current : { callId: approval?.callId, selected: 0, feedback: false });
  const { selected, feedback } = selection();
  const choose = (change: (from: PromptSelection) => Partial<PromptSelection>) => {
    if (!approval) return;
    const from = selection();
    choice.current = { ...from, ...change(from), callId: approval.callId };
    setChoice(choice.current);
  };
  const [confirmBypass, setConfirmBypass] = useState(false);

  const answer = useCallback(
    (decision: Parameters<SessionController['answer']>[1]) => {
      if (approval) controller.answer(approval.callId, decision);
    },
    [approval, controller]
  );

  /** One of the prompt's five choices, by its key or a click on it. */
  const answerWith = (key: '1' | '2' | '3' | '4' | '5') => {
    if (!approval || selection().feedback) return;
    // The question before a fan-out has three answers: grant what the children need for the session or the project, or let them ask as they go.
    if (approval.grants) {
      if (key === '1') answer({ allow: true, scope: 'session' });
      else if (key === '2') answer({ allow: true, scope: 'project' });
      else if (key === '3') answer({ allow: false, proceed: true });
      return;
    }
    const pattern = approval.suggestions[selection().selected];
    if (key === '1') answer({ allow: true, scope: 'once' });
    else if (key === '2' && pattern) answer({ allow: true, scope: 'session', pattern });
    else if (key === '3' && pattern) answer({ allow: true, scope: 'project', pattern });
    else if (key === '4') answer({ allow: false, proceed: true });
    else if (key === '5') choose(() => ({ feedback: true }));
  };

  /** The profile chosen with /profile, kept for every session opened after it. */
  const profile = useRef<string | undefined>(undefined);
  const switchSession = useCallback(
    async (choice: SessionChoice): Promise<string | undefined> => {
      if (controller.running) return 'A turn is running.';
      let next: Runtime;
      try {
        next = await open({ ...choice, profile: choice.profile ?? profile.current });
      } catch (error: any) {
        return error?.message ?? String(error);
      }
      if (choice.profile) profile.current = choice.profile;
      setRuntime(next);
      dispatch({ type: 'load', messages: next.session.messages, notes: next.notes() });
      await runtime.close().catch(() => undefined);
      return undefined;
    },
    [controller, open, runtime]
  );

  /** What Escape does while the composer holds text a command put there to finish, as /config's list does. */
  const prefillBack = useRef<(() => void) | undefined>(undefined);
  /**
   * The walk back through earlier prompts, while Up has begun one. Keys read the ref, which
   * changes at once; the state is there so the row over the composer is drawn.
   */
  const [recall, setRecallView] = useState<Recall | undefined>(undefined);
  const recallRef = useRef<Recall | undefined>(undefined);
  const setRecall = (next: Recall | undefined) => {
    recallRef.current = next;
    setRecallView(next);
  };
  // Another session has its own prompts, and starts without a walk.
  useEffect(() => setRecall(undefined), [runtime]);
  /** The text each chip in the composer stands for, by its number. It goes with the draft: a walk through earlier prompts keeps it, a send or a clear empties it. */
  const chipsRef = useRef<Chips>({});

  /**
   * What the person has typed and not sent is kept on disk while they type, at most a
   * quarter of a second behind, and written at once when the process ends, so leaving, a
   * closed terminal, or a crash loses nothing. While a walk through earlier prompts shows
   * an old prompt, the draft kept is the one the walk set aside.
   */
  const draftKept = useRef<{ id: string; text: string; chips: Chips }>({ id: runtime.sessionId, text: '', chips: {} });
  const draftWritten = useRef<{ id: string; text: string; chips: Chips }>({ id: runtime.sessionId, text: '', chips: {} });
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const writeDraft = () => {
    clearTimeout(draftTimer.current);
    draftTimer.current = undefined;
    const kept = draftKept.current;
    const written = draftWritten.current;
    if (kept.id === written.id && kept.text === written.text && JSON.stringify(kept.chips) === JSON.stringify(written.chips)) return;
    try {
      // A project that is gone, as a test's is at its end, is not made again for a draft.
      if (!fs.existsSync(projectRoot)) return;
      saveDraft(projectRoot, kept.id, { text: kept.text, chips: kept.chips });
      draftWritten.current = { ...kept };
    } catch {
      // A draft that cannot be kept must not stop the person typing.
    }
  };
  const keepDraft = () => {
    const text = composer.current?.plainText ?? '';
    const walk = recallRef.current;
    draftKept.current = { id: runtime.sessionId, text: walk && isRecalled(walk, text) ? walk.stash : text, chips: chipsRef.current };
    if (!draftTimer.current) draftTimer.current = setTimeout(writeDraft, DRAFT_SAVE_MS);
  };
  /** The text was sent or cleared: nothing is left to keep, and no write still waiting may put it back. */
  const settleDraft = () => {
    clearTimeout(draftTimer.current);
    draftTimer.current = undefined;
    chipsRef.current = {};
    draftKept.current = { id: runtime.sessionId, text: '', chips: {} };
    draftWritten.current = { id: runtime.sessionId, text: '', chips: {} };
    try {
      clearDraft(projectRoot, runtime.sessionId);
    } catch {
      // Nothing to remove, or nothing that can be.
    }
  };
  useEffect(() => {
    process.on('exit', writeDraft);
    process.on('SIGHUP', writeDraft);
    process.on('SIGTERM', writeDraft);
    return () => {
      process.off('exit', writeDraft);
      process.off('SIGHUP', writeDraft);
      process.off('SIGTERM', writeDraft);
    };
  }, []);
  // A session opened here keeps the draft under its own name and takes up one an earlier session left behind.
  useEffect(() => {
    const before = draftKept.current.id;
    if (before !== runtime.sessionId) {
      try {
        clearDraft(projectRoot, before);
      } catch {
        // Already gone.
      }
      draftWritten.current = { id: runtime.sessionId, text: '', chips: {} };
    }
    if ((composer.current?.plainText ?? '') === '') {
      let found: ReturnType<typeof adoptOrphanDraft>;
      try {
        found = adoptOrphanDraft(projectRoot, runtime.sessionId);
      } catch {
        found = undefined;
      }
      if (found) {
        chipsRef.current = found.chips;
        composer.current?.setText(found.text);
        composer.current?.gotoBufferEnd();
        dispatch({ type: 'notice', level: 'info', text: `Restored the draft left unsent in session ${found.from}.` });
      }
    }
    keepDraft();
  }, [runtime]);
  /**
   * The overlay open over the composer: the request, its choices once they arrive, the
   * filter typed so far, and the chosen row. Keys read the ref, which changes at once.
   */
  type Open = { request: ChoiceRequest; items?: ChoiceItem[]; note?: string; filter: string; index: number; serial: number };
  const serial = useRef(0);
  const overlay = useRef<Open | undefined>(undefined);
  const [, setOverlayView] = useState(0);
  const setOverlay = (next: Open | undefined) => {
    // Focus moves at once, not at the next render, so a key typed right after opening or
    // choosing lands where the person sees it will.
    if (next && !overlay.current) composer.current?.blur();
    if (!next && overlay.current) composer.current?.focus();
    overlay.current = next;
    setOverlayView((count) => count + 1);
  };
  /** The row the request names, or else the choice in use, so the list opens on it. */
  const startAt = (request: ChoiceRequest, items: ChoiceItem[]) => Math.max(0, items.findIndex((item) => (request.at === undefined ? item.current : item.key === request.at)));
  const pick = (request: ChoiceRequest) => {
    const items = Array.isArray(request.items) ? request.items : undefined;
    setOverlay({ request, filter: '', index: items ? startAt(request, items) : 0, serial: (serial.current += 1), ...(items ? { items } : {}) });
    if (items) return;
    const pending = request.items as Promise<{ items: ChoiceItem[]; note?: string }>;
    const still = () => overlay.current?.request === request;
    pending.then(
      (arrived) => still() && setOverlay({ ...overlay.current!, items: arrived.items, index: startAt(request, arrived.items), ...(arrived.note ? { note: arrived.note } : {}) }),
      (error) => still() && setOverlay({ ...overlay.current!, items: [], note: error?.message ?? String(error) })
    );
  };

  const say = (level: 'info' | 'warn' | 'error', text: string) => dispatch({ type: 'notice', level, text });
  /** Choose the overlay's row at this index among those shown, by Enter or a click. */
  const chooseOverlay = (index: number) => {
    const open = overlay.current;
    const item = open?.items ? shownItems(open.items, open.filter, open.request.freeText)[index] : undefined;
    if (!open || !item) return;
    setOverlay(undefined);
    Promise.resolve(open.request.choose(item)).catch((error: any) => say('error', error?.message ?? String(error)));
  };
  const context = (): CommandContext => ({
    runtime,
    projectRoot,
    running: controller.running,
    ...(profile.current ? { profile: profile.current } : {}),
    show: (text, diff) => dispatch({ type: 'output', text, ...(diff ? { diff } : {}) }),
    notice: say,
    event: (event) => dispatch({ type: 'event', event }),
    working: (phase) => {
      controller.hold(phase !== 'idle');
      dispatch({ type: 'status', patch: { phase } });
    },
    refresh: () => controller.refresh(),
    openSession: switchSession,
    opensSessions: true,
    setMode: (mode) => void controller.setMode(mode),
    confirmBypass: () => setConfirmBypass(true),
    copy: (text) => copyText(text),
    exit: onExit,
    commands: () => commands,
    choose: pick,
    answerChoice: () => say('info', 'Lists open on the screen here: choose with the arrow keys and Enter, or Escape to close one.'),
    themeName: theme.name,
    setTheme: (name) => setTheme(resolveTheme(name, process.env)),
    statusStyle,
    setStatusStyle,
    note: (text) => {
      // Planted in the log first, so the flag on screen is one that is kept.
      runtime.note(text);
      dispatch({ type: 'note', note: { text, ts: Date.now() } });
    },
    clearNotes: () => dispatch({ type: 'clear_notes' }),
    prefill: (text, back) => {
      composer.current?.setText(text);
      composer.current?.gotoBufferEnd();
      prefillBack.current = back;
    },
    send: (prompt, options) => void controller.submit(prompt, options),
    keyFor: (action) => (KEY_ACTIONS.includes(action as KeyAction) ? keysFor(keys.bindings, action as KeyAction) : undefined),
    keyHelp: () => keysHelp(keys.bindings),
  });

  // An MCP server's request for input is asked in an overlay, with the context as it is then.
  controller.onElicitation = (event) => answerElicitation(context(), event);

  /** Search what the person has sent before, and put the chosen message in the composer. */
  const openHistory = () =>
    pick({
      title: 'Earlier messages, newest first',
      items: earlierMessages(projectRoot, { id: runtime.sessionId, prompts: runtime.prompts(), messages: runtime.session.messages }),
      empty: 'Nothing sent yet in this project.',
      hint: 'Enter puts it in the composer',
      choose: (item) => {
        const chosen = item.value ?? item.label;
        setAside(chosen);
        composer.current?.setText(chosen);
        composer.current?.gotoBufferEnd();
      },
    });

  const runCommand = async (line: string, options: { quiet?: boolean } = {}) => {
    const parsed = parseCommand(line);
    if (!parsed) return;
    const command = findCommand(commands, parsed.name);
    // A custom command's line is shown as the message it sends.
    if (!options.quiet && command?.source !== 'user' && command?.source !== 'project' && command?.source !== 'mcp') dispatch({ type: 'command', text: line });
    if (!command) return say('warn', `/${parsed.name} is not a command. /help lists them.`);
    try {
      await command.run(context(), parsed.args);
    } catch (error: any) {
      say('error', `/${command.name} failed: ${error?.message ?? error}`);
    }
  };
  // A first run opens setup, once, on the session it started with.
  useEffect(() => {
    if (props.firstRun) void runCommand('/setup', { quiet: true });
    // A project's hooks are asked about once, before they can run; setup goes first.
    else if (!runtime.hooks().projectTrusted) askToTrustHooks(context());
  }, []);

  /**
   * The palette, while a command is being named: what was typed, which match is chosen,
   * and whether Escape closed it for this text. Keys read the ref, which changes at once.
   */
  const palette = useRef<{ draft: string; index: number; closed?: string }>({ draft: '', index: 0 });
  const [, setPaletteView] = useState(palette.current);
  const setPalette = (next: typeof palette.current) => {
    palette.current = next;
    setPaletteView(next);
  };
  // A prompt recalled as it was sent is not a command being named, so it opens no list that would take Up and Down.
  const matchesFor = (draft: string) => (naming(draft) && palette.current.closed !== draft && !isRecalled(recallRef.current, draft) ? matchCommands(commands, draft) : undefined);
  /** What `@` can name, read once per session when the first `@` is typed. */
  const [referenceItems, setReferenceItems] = useState<ReferenceItem[] | undefined>(undefined);
  const referencesLoading = useRef(false);
  useEffect(() => {
    setReferenceItems(undefined);
    referencesLoading.current = false;
  }, [runtime]);
  const referencesFor = (draft: string) => {
    const token = referenceToken(draft);
    if (token === undefined || naming(draft) || palette.current.closed === draft || isRecalled(recallRef.current, draft)) return undefined;
    return matchReferences(referenceItems ?? [], token);
  };
  const onDraft = () => {
    keepDraft();
    const draft = composer.current?.plainText ?? '';
    if (draft !== palette.current.draft) setPalette({ draft, index: 0, closed: palette.current.closed === draft ? draft : undefined });
    if (referenceToken(draft) !== undefined && !referenceItems && !referencesLoading.current) {
      referencesLoading.current = true;
      void referenceCandidates(runtime).then(setReferenceItems, () => setReferenceItems([]));
    }
  };
  const matches = matchesFor(palette.current.draft);
  const referenceMatches = matches ? undefined : referencesFor(palette.current.draft);
  const completeWith = (item: ReferenceItem) => {
    const next = completeReference(composer.current?.plainText ?? '', item);
    composer.current?.setText(next);
    composer.current?.gotoBufferEnd();
    setPalette({ draft: next, index: 0 });
  };

  /** Append a `#` note to AGENTS.md after showing it, through the tool path so permissions and checkpoints apply. */
  const appendNote = (note: string) => {
    const file = 'AGENTS.md';
    let current = '';
    try {
      current = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    } catch {
      // A missing file is created by the same confirmation.
    }
    const call = noteCall(file, current, note);
    // After the key event, so the Enter that submitted this does not also choose the first row.
    setTimeout(() => {
      pick({
        title: `Append to ${file}?`,
        items: [
          { key: 'yes', label: 'Add it', detail: `+ ${note}` },
          { key: 'no', label: 'Do not', detail: 'nothing is written' },
        ],
        empty: '',
        hint: 'Enter chooses · Escape says no',
        choose: (item) => {
          if (item.key === 'yes') void controller.submit(`#${note}`, { display: `#${note}`, tool: call });
        },
        dismissed: () => undefined,
      });
    }, 0);
  };

  /**
   * A paste. Its line endings are made one kind. A large one becomes a chip, and a paste with
   * the cursor on a chip, or right after it, expands that chip in place instead.
   */
  const onPaste = (event: PasteEvent) => {
    event.preventDefault();
    const area = composer.current;
    if (!area) return;
    const pasted = normalizeNewlines(stripAnsiSequences(decodePasteBytes(event.bytes)));
    if (!pasted) return;
    const text = area.plainText;
    const hit = chipAt(text, area.logicalCursor.offset, chipsRef.current);
    if (hit) {
      const { [hit.id]: full, ...rest } = chipsRef.current;
      chipsRef.current = rest;
      area.replaceText(text.slice(0, hit.start) + full + text.slice(hit.end));
      area.cursorOffset = hit.start + full.length;
    } else if (isLarge(pasted)) {
      const id = nextChipId(chipsRef.current);
      chipsRef.current = { ...chipsRef.current, [id]: pasted };
      area.insertText(chipLabel(id, pasted));
    } else {
      area.insertText(pasted);
    }
  };

  /** A line sent from the composer is recorded as typed, and ends any walk through earlier prompts. */
  const sentLine = (line: string) => {
    runtime.prompt(line, 'sent');
    setRecall(undefined);
    settleDraft();
  };

  /** Put a step of the walk in the composer; an edit the walk left behind is kept as a cleared prompt. */
  const applyRecall = (move: Move) => {
    if (move.abandoned) runtime.prompt(expandChips(move.abandoned, chipsRef.current), 'cleared');
    setRecall(move.recall);
    composer.current?.setText(move.text);
    composer.current?.gotoBufferEnd();
  };

  const submit = () => {
    const typed = composer.current?.plainText ?? '';
    const text = expandChips(typed, chipsRef.current).trim();
    if (!text) return;
    prefillBack.current = undefined;
    // Enter on an `@` word still being typed completes it rather than sending.
    const referenced = referencesFor(typed)?.[palette.current.index];
    if (referenced) return completeWith(referenced);
    // `#` opens a note to the project's AGENTS.md, through the tool path.
    const note = noteText(text);
    if (note) {
      sentLine(text);
      composer.current?.setText('');
      setPalette({ draft: '', index: 0 });
      return void appendNote(note);
    }
    // Enter on a name still being typed runs the chosen match.
    const listed = matchesFor(typed);
    const chosen = listed?.[palette.current.index];
    const line = listed && chosen && !findCommand(commands, parseCommand(text)?.name ?? '') ? `/${chosen.name}` : text;
    sentLine(line);
    composer.current?.setText('');
    setPalette({ draft: '', index: 0 });
    if (line.startsWith('/')) return void runCommand(line);
    // `!` runs what follows as a shell command, under the same permissions as the model's.
    // A message puts the children that already ended behind the person, and lets go of the one chosen.
    setSentAt(Date.now());
    setAgentFocus(undefined);
    if (text.startsWith('!') && text.slice(1).trim()) return void controller.submit(text.slice(1).trim(), { shell: true, display: text });
    void controller.submit(text);
  };

  /**
   * Put aside what the composer holds before something else takes its place. What it held
   * and what a walk had set aside are kept as cleared prompts, so nothing typed is gone for
   * good; a prompt recalled and left as it was is in history already, and so is text that is
   * to be put back as it is.
   */
  const setAside = (replacement = '') => {
    const text = composer.current?.plainText ?? '';
    const stash = recallRef.current?.stash;
    if (stash?.trim()) runtime.prompt(expandChips(stash, chipsRef.current), 'cleared');
    if (text.trim() && text !== replacement && !isRecalled(recallRef.current, text)) runtime.prompt(expandChips(text, chipsRef.current), 'cleared');
    setRecall(undefined);
    chipsRef.current = {};
  };

  /** Empty the composer, keeping what it held. */
  const clearComposer = () => {
    setAside();
    composer.current?.setText('');
    setPalette({ draft: '', index: 0 });
    settleDraft();
  };

  /** Stop the turn; what was queued behind it comes back to the composer, ahead of any draft. */
  const stopTurn = () => {
    const back = controller.cancel();
    if (!back) return;
    const draft = composer.current?.plainText ?? '';
    composer.current?.setText(draft ? `${back}\n${draft}` : back);
  };

  /** A page of the transcript, and at its top, earlier rows. */
  const page = (up: boolean) => {
    const box = transcript.current;
    if (!box) return;
    anchor.current = undefined;
    if (up && box.scrollTop <= 0 && hidden > 0) {
      anchor.current = { fromBottom: box.scrollHeight - box.scrollTop, until: Date.now() + ANCHOR_MS };
      return setDrawn((count) => count + TRANSCRIPT_ROWS);
    }
    box.scrollBy(up ? -1 : 1, 'viewport');
  };

  useKeyboard((key) => {
    // The detailed transcript is closed first: Escape or the exit key returns to the
    // conversation before it stops a turn, answers a prompt, or leaves.
    if (viewer && (key.name === 'escape' || bound('exit', key))) {
      key.preventDefault();
      return closeViewer();
    }
    if (bound('exit', key)) {
      if (controller.running) return stopTurn();
      // Text in the composer, or set aside by a walk through earlier prompts, is cleared before the key counts toward leaving.
      if ((composer.current?.plainText ?? '') !== '' || recallRef.current?.stash.trim()) {
        exitArmed.current = false;
        return clearComposer();
      }
      if (exitArmed.current) return onExit();
      exitArmed.current = true;
      dispatch({ type: 'notice', level: 'info', text: `Press ${keysFor(keys.bindings, 'exit')} again to exit.` });
      setTimeout(() => (exitArmed.current = false), 2_000);
      return;
    }
    // Escape while looking in on a child closes that view before it can answer a prompt that came up meanwhile.
    if (agentView && viewedAgent && key.name === 'escape') {
      key.preventDefault();
      return closeAgent();
    }
    if (confirmBypass) {
      if (key.name === 'escape') {
        setConfirmBypass(false);
        dispatch({ type: 'notice', level: 'info', text: 'Bypass mode was not turned on.' });
      }
      return;
    }
    // Page keys still scroll the transcript behind a prompt, and the detailed transcript
    // still opens and moves, so what the model said before the call can be read before it
    // is answered.
    if (approval && !viewer && !bound('page_up', key) && !bound('page_down', key) && !bound('tool_detail', key)) {
      const now = selection();
      if (key.name === 'escape') {
        // The Esc badge turns red first, so the no is seen before the prompt goes.
        setEscaping(true);
        setTimeout(() => answer({ allow: false }), ESC_FLASH_MS);
      } else if (now.feedback) return;
      else if (key.name === '1' || key.name === 'y') answerWith('1');
      else if (key.name === '2' || key.name === '3' || key.name === '4') answerWith(key.name);
      else if (key.name === 'n' && approval.grants) answerWith('3');
      else if (key.name === '5' || key.name === 'n') answerWith('5');
      else if (key.name === 'down') choose((from) => ({ selected: Math.min(from.selected + 1, Math.max(0, approval.suggestions.length - 1)) }));
      else if (key.name === 'up') choose((from) => ({ selected: Math.max(0, from.selected - 1) }));
      else if (key.sequence === 'o' && !key.ctrl && !key.meta && approval.from) openAgent(approval.from.task);
      return;
    }
    const open = overlay.current;
    if (open) {
      // The list takes the keys that move through it; the filter's input takes the rest.
      const shown = open.items ? shownItems(open.items, open.filter, open.request.freeText) : [];
      const last = Math.max(0, shown.length - 1);
      const step = { down: 1, up: -1, pagedown: PICKER_ROWS, pageup: -PICKER_ROWS }[key.name as 'down'];
      if (key.name === 'escape') {
        key.preventDefault();
        setOverlay(undefined);
        open.request.dismissed?.();
      } else if (step) {
        key.preventDefault();
        setOverlay({ ...open, index: Math.min(Math.max(0, open.index + step), last) });
      }
      return;
    }
    if (viewer) {
      // The detailed transcript takes the keys that move through it, and gives the rest back.
      key.preventDefault();
      const box = transcript.current;
      if (bound('tool_detail', key)) return closeViewer();
      if (key.name === 'up' || key.name === 'down') return box?.scrollBy(key.name === 'up' ? -1 : 1);
      if (bound('page_up', key) || bound('page_down', key)) return page(bound('page_up', key));
      if (key.name === 'home') return box?.scrollTo(0);
      if (key.name === 'end') return box?.scrollTo(box.scrollHeight);
      if (key.sequence === 'v' && !key.ctrl && !key.meta) return openLogInCode();
      if (key.sequence === '?') return setViewerHelp((shown) => !shown);
      return;
    }
    if (agentView && viewedAgent) {
      // A child's run takes the keys that move through it; while it runs, the rest type a message to it.
      const box = agentBox.current;
      const scrolls = key.name === 'up' || key.name === 'down' || key.name === 'home' || key.name === 'end' || bound('page_up', key) || bound('page_down', key);
      if (scrolls) {
        key.preventDefault();
        if (key.name === 'up' || key.name === 'down') return box?.scrollBy(key.name === 'up' ? -1 : 1);
        if (key.name === 'home') return box?.scrollTo(0);
        if (key.name === 'end') return box?.scrollTo(box.scrollHeight);
        return box?.scrollBy(bound('page_up', key) ? -1 : 1, 'viewport');
      }
      if (viewedAgent.endedAt !== undefined) {
        key.preventDefault();
        if (key.sequence === 'o' && !key.ctrl && !key.meta && viewedAgent.sessionId) {
          const id = viewedAgent.sessionId;
          closeAgent();
          return void switchSession({ sessionId: id }).then((refusal) => refusal && say('warn', `Its session was not opened: ${refusal}`));
        }
      }
      return;
    }
    const draft = composer.current?.plainText ?? '';
    // The child chosen is one the board still lists: a choice its child has just outlived is already let go.
    const walkable = listedWork.filter((item) => item.kind === 'task');
    const focused = walkable.some((item) => item.id === agentFocusRef.current) ? agentFocusRef.current : undefined;
    // Down on an empty composer takes the last queued message back to edit, unsent.
    if (key.name === 'down' && draft === '' && state.queued.length && !approval && !focused) {
      key.preventDefault();
      const back = controller.takeQueued();
      if (back) composer.current?.setText(back);
      return;
    }
    // On an empty composer, Up and Down walk the children on the board and Enter looks in on the chosen one.
    // Escape lets go of the choice between turns; while a turn runs it still stops the turn.
    // Up is for earlier prompts, so it walks the board only once a child is chosen; Down chooses one.
    const walking = key.name === 'down' || (focused && (key.name === 'up' || key.name === 'return' || (key.name === 'escape' && !controller.running)));
    if (draft === '' && walkable.length && !approval && walking) {
      key.preventDefault();
      if (key.name === 'escape') return setAgentFocus(undefined);
      if (key.name === 'return') return openAgent(focused!);
      const at = walkable.findIndex((item) => item.id === focused);
      // The first move lands on a running child, since that is the one worth looking in on.
      const running = walkable.findIndex((item) => item.endedAt === undefined);
      const first = running >= 0 ? running : 0;
      // Up from the first child lets go of the choice, so the next Up is a prompt.
      if (key.name === 'up' && at <= 0) return setAgentFocus(undefined);
      const next = at < 0 ? first : Math.min(Math.max(0, at + (key.name === 'up' ? -1 : 1)), walkable.length - 1);
      setBoard((shown) => (shown === 'hidden' ? 'auto' : shown));
      return setAgentFocus(walkable[next].id);
    }
    // Text a list put in the composer to finish: Escape takes it back out, unsent, and returns.
    if (key.name === 'escape' && prefillBack.current && !controller.running) {
      key.preventDefault();
      const back = prefillBack.current;
      prefillBack.current = undefined;
      composer.current?.setText('');
      return back();
    }
    // Escape ends a walk through earlier prompts and gives the draft back.
    if (key.name === 'escape' && recallRef.current && !controller.running) {
      key.preventDefault();
      return applyRecall(recallEscape(recallRef.current, draft)!);
    }
    // Help, on an empty composer, lists the commands and keys.
    if (bound('help', key) && draft === '') {
      key.preventDefault();
      return void runCommand('/help', { quiet: true });
    }
    const listed = matchesFor(draft);
    if (listed) {
      const moves = key.name === 'down' ? 1 : key.name === 'up' ? -1 : 0;
      if (moves) {
        key.preventDefault();
        const index = Math.min(Math.max(0, palette.current.index + moves), Math.max(0, listed.length - 1));
        return setPalette({ ...palette.current, draft, index });
      }
      if (key.name === 'tab' && !key.shift) {
        key.preventDefault();
        const chosen = listed[palette.current.index];
        if (chosen) {
          composer.current?.setText(`/${chosen.name} `);
          composer.current?.gotoBufferEnd();
        }
        return;
      }
      if (key.name === 'escape') {
        key.preventDefault();
        composer.current?.setText('');
        return setPalette({ draft: '', index: 0 });
      }
    }
    const referenced = listed ? undefined : referencesFor(draft);
    if (referenced) {
      const moves = key.name === 'down' ? 1 : key.name === 'up' ? -1 : 0;
      if (moves) {
        key.preventDefault();
        return setPalette({ ...palette.current, draft, index: Math.min(Math.max(0, palette.current.index + moves), Math.max(0, referenced.length - 1)) });
      }
      if (key.name === 'tab' && !key.shift) {
        key.preventDefault();
        const chosen = referenced[palette.current.index];
        if (chosen) completeWith(chosen);
        return;
      }
      if (key.name === 'escape') {
        key.preventDefault();
        return setPalette({ draft, index: 0, closed: draft });
      }
    }
    // Up on the first line recalls the previous prompt; Down on the last walks forward. A prompt
    // still as it was recalled is walked from any line, so a long one is not crawled through.
    if ((key.name === 'up' || key.name === 'down') && !key.shift && !key.ctrl && !key.meta) {
      const walking = isRecalled(recallRef.current, draft);
      const edit = composer.current;
      const { row, last: lastRow } = edit
        ? cursorLines({ visualRow: edit.visualCursor.visualRow, virtualLineCount: edit.virtualLineCount, logicalRow: edit.logicalCursor.row, lineCount: edit.lineCount })
        : { row: 0, last: 0 };
      const move =
        key.name === 'up'
          ? walking || row === 0
            ? recallUp(recallRef.current, draft, runtime.prompts().slice().reverse())
            : undefined
          : walking || row >= lastRow
          ? recallDown(recallRef.current, draft)
          : undefined;
      if (move) {
        key.preventDefault();
        return applyRecall(move);
      }
    }
    const up = bound('page_up', key);
    if (up || bound('page_down', key)) {
      key.preventDefault();
      return page(up);
    }
    if (bound('interrupt', key) && controller.running) return stopTurn();
    if (bound('cycle_mode', key)) {
      key.preventDefault();
      controller.cycleMode();
      return;
    }
    if (bound('tool_detail', key)) {
      key.preventDefault();
      return openViewer();
    }
    if (bound('history', key)) {
      key.preventDefault();
      return openHistory();
    }
    if (bound('todos', key)) {
      key.preventDefault();
      // The key hides a board that shows something, and pins one that is hidden or has gone empty.
      const showing = board === 'pinned' || (board === 'auto' && (hasTodos || listedWork.length > 0));
      return setBoard(showing ? 'hidden' : 'pinned');
    }
    if (bound('redraw', key)) renderer.requestRender();
  });

  const chords = (action: KeyAction, submitAs: 'submit' | 'newline') =>
    keys.bindings[action].filter((chord) => chord.name.length > 1 || /[a-z]/.test(chord.name)).map((chord) => ({ name: chord.name, ctrl: chord.ctrl, shift: chord.shift, meta: chord.meta, action: submitAs }));

  const plain = screenReader;
  // Past two lines, the lines and characters that will be sent, chips at their full size.
  const willSend = expandChips(palette.current.draft, chipsRef.current);
  const draftLines = willSend.split('\n').length;
  const counted = draftLines >= 3 ? (plain ? `Draft: ${draftLines} lines, ${willSend.length.toLocaleString('en-US')} characters.` : `${draftLines} lines · ${willSend.length.toLocaleString('en-US')} chars`) : undefined;
  const status = statusParts(state.status);
  // The indicator moves during work
  // Not drawn while Screen reader mode = true
  const moving = !reducedMotion && WORKING.has(state.status.phase);
  // A style's word for the phase is picked as the phase begins, from how many have begun, and holds until it changes.
  if (phases.current.phase !== state.status.phase) phases.current = { phase: state.status.phase, count: phases.current.count + 1 };
  const shown = (moving && phaseWord(statusStyle.words, state.status.phase, phases.current.count)) || status.at(-1)!;
  // What the status line's words have left of the width, beside the flash and the indicator (its spinner, a space, the words shown, and a separator).
  const statusRoom = Math.max(1, size.width - (flash ? flash.length + 3 : 0) - (moving ? shown.length + 5 : 0) - (plain ? 'Status: '.length : 0));
  return (
    <ThemeContext.Provider value={theme}>
      <PlainContext.Provider value={plain}>
        <MotionContext.Provider value={reducedMotion}>
          {micro ? (
            <box height={1} width="100%">
              <text {...sel} fg={state.approvals.length ? theme.warn : theme.text}>{fitPhrase(microPhrase(state), Math.max(1, size.width))}</text>
            </box>
          ) : null}
          <box flexDirection="column" width="100%" height="100%" visible={!micro} onMouseDrag={dragPast} onMouseUp={endDrag} onMouseDragEnd={endDrag}>
            <box height={1} flexShrink={0}>
              <text {...sel} fg={theme.dim}>{`${plain ? 'JamCLI, project ' : 'jamcli · '}${path.basename(projectRoot)}${branch ? `${plain ? ', branch ' : ' · '}${branch}` : ''}${plain ? ', session ' : ' · session '}${runtime.sessionId}`}</text>
            </box>
            {state.notes.length ? <NotesPanel notes={state.notes} plain={plain} colors={theme} /> : null}
            {viewer ? (
              <box flexDirection="column" flexShrink={0}>
                <text {...sel} fg={theme.warn} flexShrink={0}>{`${plain ? 'Note: ' : ''}Showing detailed transcript · ${keysFor(keys.bindings, 'tool_detail')} to toggle · ↑↓ scroll · v to open in code · ? for shortcuts`}</text>
                {viewerHelp ? (
                  <text {...sel} fg={theme.dim} flexShrink={0}>{`↑↓ a line · ${keysFor(keys.bindings, 'page_up')} and ${keysFor(keys.bindings, 'page_down')} a page · Home and End the top and bottom · click a tool or thinking line to hide or show it · v opens the whole session log in code · ${keysFor(keys.bindings, 'tool_detail')}, Escape, or ${keysFor(keys.bindings, 'exit')} returns to the conversation`}</text>
                ) : null}
              </box>
            ) : null}
            {agentView && viewedAgent ? <AgentViewer runtime={runtime} item={viewedAgent} syntax={syntax} thinking={thinking} focus={(box) => (agentBox.current = box)} /> : null}
            <scrollbox ref={transcript} flexGrow={1} stickyScroll stickyStart="bottom" viewportCulling visible={!(agentView && viewedAgent)} onMouseDown={keepComposerFocus} {...(plain ? { verticalScrollbarOptions: { visible: false } } : { contentOptions: { paddingRight: 1 } })}>
              {hidden ? (
                <text {...sel} fg={theme.dim}>{`${plain ? 'Note: ' : ''}${hidden} earlier row${hidden === 1 ? ' is' : 's are'} not drawn. ${keysFor(keys.bindings, 'page_up')} at the top draws ${Math.min(hidden, TRANSCRIPT_ROWS)} more.`}</text>
              ) : null}
              {(hidden ? state.rows.slice(hidden) : state.rows).map((row) => (
                <RowView key={row.id} row={row} syntax={syntax} thinking={thinking} {...(viewer ? { open: !viewer.has(row.id), onToggle: toggleInViewer } : { onToggle: (id: number) => dispatch({ type: 'toggle', id }) })} />
              ))}
            </scrollbox>
            {board !== 'hidden' && !viewer ? (
              <TodoPanel todos={state.todos} plan={state.plan} phase={state.status.phase} plain={plain} colors={theme} focus={agentFocus} listed={listedWork} pinned={board === 'pinned'} onOpen={openAgent} />
            ) : null}
            {state.queued.length && !viewer ? (
              <box flexDirection="column" flexShrink={0} paddingLeft={plain ? 0 : 2}>
                {state.queued.map((text, index) => (
                  <text {...sel} key={index} fg={theme.dim} wrapMode="none" truncate>
                    {plain ? `Queued: ${text}` : `↳ ${text.replace(/\s+/g, ' ')}`}
                    {index === state.queued.length - 1 ? (plain ? ', Down takes it back to edit' : ' · queued, ↓ edit') : ''}
                  </text>
                ))}
              </box>
            ) : null}
            {approval ? (
              <PermissionPrompt
                approval={approval}
                asking={asking}
                queued={prompts}
                syntax={syntax}
                file={(state.rows.find((row) => row.kind === 'tool' && row.callId === approval.callId) as { path?: string } | undefined)?.path}
                selected={selected}
                feedback={feedback}
                escaping={escaping}
                onFeedback={(text) => answer({ allow: false, ...(text.trim() ? { feedback: text.trim() } : {}) })}
                onChoose={answerWith}
              />
            ) : confirmBypass ? (
              <BypassConfirm
                onAnswer={(text) => {
                  setConfirmBypass(false);
                  if (text.trim().toLowerCase() === 'yes') controller.setMode('bypass', { bypassConfirmed: true });
                  else dispatch({ type: 'notice', level: 'info', text: 'Bypass mode was not turned on.' });
                }}
              />
            ) : (
              <box flexDirection="column" flexShrink={0} visible={!viewer && !(agentView && viewedAgent)}>
                {overlay.current ? (
                  <Picker
                    key={overlay.current.serial}
                    title={overlay.current.request.title}
                    items={overlay.current.items}
                    note={overlay.current.note ?? overlay.current.request.note}
                    empty={overlay.current.request.empty}
                    hint={overlay.current.request.hint}
                    filter={overlay.current.filter}
                    selected={overlay.current.index}
                    onPick={chooseOverlay}
                    onFilter={(filter) => overlay.current && setOverlay({ ...overlay.current, filter, index: 0 })}
                    onSubmit={() => overlay.current && chooseOverlay(overlay.current.index)}
                    onHover={(index) => overlay.current && overlay.current.index !== index && setOverlay({ ...overlay.current, index })}
                    onScroll={(step) => {
                      const open = overlay.current;
                      if (!open?.items) return;
                      const last = Math.max(0, shownItems(open.items, open.filter, open.request.freeText).length - 1);
                      setOverlay({ ...open, index: Math.min(Math.max(0, open.index + step), last) });
                    }}
                    {...(overlay.current.request.freeText !== undefined ? { freeText: overlay.current.request.freeText } : {})}
                  />
                ) : matches ? (
                  <Palette
                    matches={matches}
                    selected={palette.current.index}
                    onHover={(index) => index !== palette.current.index && setPalette({ ...palette.current, index })}
                    onScroll={(step) => setPalette({ ...palette.current, index: Math.min(Math.max(0, palette.current.index + step), Math.max(0, matches.length - 1)) })}
                    onPick={(index) => {
                      setPalette({ ...palette.current, index });
                      submit();
                    }}
                  />
                ) : referenceMatches ? (
                  <ReferencePalette
                    matches={referenceMatches}
                    selected={palette.current.index}
                    loading={!referenceItems}
                    onHover={(index) => index !== palette.current.index && setPalette({ ...palette.current, index })}
                    onScroll={(step) => setPalette({ ...palette.current, index: Math.min(Math.max(0, palette.current.index + step), Math.max(0, referenceMatches.length - 1)) })}
                    onPick={(index) => referenceMatches[index] && completeWith(referenceMatches[index])}
                  />
                ) : null}
                {recall ? (
                  <text {...sel} fg={theme.dim} wrapMode="none" truncate>
                    {describeRecall(recall, Date.now(), plain)}
                  </text>
                ) : null}
                <box
                  {...framed(plain, theme.border)}
                  flexShrink={0}
                  minHeight={plain ? 1 : 3}
                  maxHeight={plain ? COMPOSER_LINES : COMPOSER_LINES + 2}
                  {...(counted && !plain ? { bottomTitle: ` ${counted} `, bottomTitleAlignment: 'right' as const } : {})}
                >
                  <textarea
                    ref={composer}
                    maxHeight={COMPOSER_LINES}
                    onPaste={onPaste}
                    focused={!overlay.current && !viewer && !agentView}
                    textColor={theme.text}
                    focusedTextColor={theme.text}
                    placeholderColor={theme.dim}
                    cursorColor={theme.text}
                    /* An invitation, not a keybinding manual: the two ways in, and `?` reaches the rest. */
                    placeholder={plain ? 'Message: Message JamCLI' : 'Message JamCLI · / commands · ? help'}
                    keyBindings={[...chords('send', 'submit'), ...chords('newline', 'newline')]}
                    onSubmit={submit}
                    onContentChange={onDraft}
                  />
                </box>
                {counted && plain ? <text {...sel}>{counted}</text> : null}
              </box>
            )}
            <box height={1} flexShrink={0} flexDirection="row">
              {flash ? <text {...sel} fg={theme.accent}>{`${flash}${plain ? '. ' : ' · '}`}</text> : null}
              {moving ? <Indicator style={statusStyle} words={shown} /> : null}
              <text {...sel} fg={state.status.mode === 'bypass' ? theme.error : theme.dim}>{`${plain ? 'Status: ' : ''}${fitStatus(state.status, statusRoom, { separator: plain ? ', ' : ' · ', withoutPhase: moving })}`}</text>
            </box>
          </box>
        </MotionContext.Provider>
      </PlainContext.Provider>
    </ThemeContext.Provider>
  );
}
