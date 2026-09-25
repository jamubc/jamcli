/** @jsxImportSource @opentui/react */
import path from 'path';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useKeyboard, useRenderer } from '@opentui/react';
import type { ScrollBoxRenderable, TextareaRenderable } from '@opentui/core';
import type { Runtime } from '../../core/runtime/index.js';
import { initialView, reduceView, type ViewState } from '../state/view.js';
import { SessionController, statusOf, gitBranch } from './controller.js';
import { statusParts } from './format.js';
import { Indicator } from './Indicator.js';
import { DEFAULT_STATUS_STYLE, type StatusStyleDefinition } from '../../styles/statusStyles.js';
import { createSyntaxStyle } from './syntax.js';
import { BUILTIN_COMMANDS, findCommand, matchCommands, parseCommand, type CommandContext, type SessionChoice, type SlashCommand } from './commands.js';
import { customCommands } from './custom.js';
import { askToTrustHooks } from './extensions.js';
import { answerElicitation } from './elicit.js';
import { Palette } from './Palette.js';
import { Picker, shownItems, PICKER_ROWS, type PickItem, type PickRequest } from './Picker.js';
import { MotionContext, PlainContext, THEMES, ThemeContext, framed, type Theme } from './theme.js';
import { keysFor, loadKeybindings, matchesAction, type KeyAction, type KeyLike, type Keybindings } from './keys.js';
import { earlierMessages } from './history.js';
import type { TodoView } from '../state/view.js';
import { RowView } from './Rows.js';
import { BypassConfirm, PermissionPrompt } from './Prompt.js';

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
  /** The keys, with what was wrong in the keybindings file. Read from the user's file when absent. */
  keys?: { bindings: Keybindings; problems: string[] };
  /** No user configuration and no model: open setup at the start. */
  firstRun?: boolean;
  /** The working indicator's spinner and colors. Defaults to the classic spinner with subtle words. */
  statusStyle?: StatusStyleDefinition;
}

/**
 * How many transcript rows are drawn at first. A long session resumes with its latest
 * rows, and Page Up at the top draws as many again, so memory and the time to resume
 * follow what the person reads, not the session's length.
 */
export const TRANSCRIPT_ROWS = 200;

/** How long the view holds its place while earlier rows are laid out. */
const ANCHOR_MS = 600;

const WORKING = new Set(['thinking', 'streaming', 'tool', 'retrying', 'compacting']);

const TODO_WORDS: Record<TodoView['status'], string> = { pending: 'to do', in_progress: 'doing', completed: 'done' };

/** The model's todo list, shown and hidden with the todos key. */
function TodoPanel({ todos, plain, colors }: { todos: TodoView[] | undefined; plain: boolean; colors: Theme }) {
  return (
    <box {...framed(plain, colors.border)} flexDirection="column" flexShrink={0}>
      <text fg={colors.accent}>Todo list</text>
      {todos?.length ? (
        todos.map((todo, index) => (
          <text key={index} fg={todo.status === 'completed' ? colors.dim : colors.text}>
            {`${TODO_WORDS[todo.status]}: ${todo.status === 'in_progress' && todo.active_form ? todo.active_form : todo.content}`}
          </text>
        ))
      ) : (
        <text fg={colors.dim}>No todo list yet. The model writes one with todo_write as it works.</text>
      )}
    </box>
  );
}

/** The pattern a prompt offers, by its place among the suggestions, and whether it is taking feedback. */
interface PromptSelection {
  callId?: string;
  selected: number;
  feedback: boolean;
}

/** A composer line that starts with a slash and has no space yet is a command being named. */
const naming = (draft: string) => draft.startsWith('/') && !/\s/.test(draft);

/** Commands the design names that arrive with later work. Typing one says so rather than calling it unknown. */
const LATER = new Set(['plugins', 'workflows']);

export function App(props: AppProps) {
  const { runtime: first, projectRoot, onExit, openSession: open, commands: extra = [], theme: startTheme = THEMES.dark, screenReader = false } = props;
  const reducedMotion = screenReader || Boolean(props.reducedMotion);
  const keys = useMemo(() => props.keys ?? loadKeybindings(), [props.keys]);
  const bound = (action: KeyAction, key: KeyLike) => matchesAction(keys.bindings, action, key);
  const [showTodos, setShowTodos] = useState(false);
  const renderer = useRenderer();
  // A session opened with messages already in it shows them from the first frame.
  const [state, dispatch] = useReducer(reduceView, undefined, (): ViewState =>
    // The status line has the session's facts from the first frame, not after an effect.
    first.session.messages.length ? reduceView(initialView(statusOf(first)), { type: 'load', messages: first.session.messages }) : initialView(statusOf(first))
  );
  const [runtime, setRuntime] = useState(first);
  const controller = useMemo(() => new SessionController(runtime, dispatch), [runtime]);
  // Custom commands are read again with each session, so a file added meanwhile is found.
  const custom = useMemo(() => customCommands(projectRoot, BUILTIN_COMMANDS), [projectRoot, runtime]);
  const commands = useMemo(() => [...BUILTIN_COMMANDS, ...custom.commands, ...extra], [custom, extra]);
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
  const [exitArmed, setExitArmed] = useState(false);
  const branch = useMemo(() => gitBranch(runtime.workRoot), [runtime.workRoot]);
  const [theme, setTheme] = useState<Theme>(startTheme);
  const [statusStyle, setStatusStyle] = useState<StatusStyleDefinition>(props.statusStyle ?? DEFAULT_STATUS_STYLE);
  const syntax = useMemo(() => createSyntaxStyle(theme), [theme]);
  useEffect(() => () => syntax.destroy(), [syntax]);

  useEffect(() => {
    controller.refresh();
    for (const notice of runtime.notices) dispatch({ type: 'notice', level: 'warn', text: notice });
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

  const approval = state.approvals[0];
  /**
   * Which suggested pattern the prompt offers, and whether it is taking feedback, for the
   * call it was chosen on. A new call starts over without an effect, so a key pressed as
   * the prompt appears is never undone by a reset that runs after it. Keys read the ref,
   * which changes at once: Up then 2, arriving together, grant the pattern Up chose.
   */
  const [, setChoice] = useState<PromptSelection>({ selected: 0, feedback: false });
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
      dispatch({ type: 'load', messages: next.session.messages });
      await runtime.close().catch(() => undefined);
      return undefined;
    },
    [controller, open, runtime]
  );

  /**
   * The overlay open over the composer: the request, its choices once they arrive, the
   * filter typed so far, and the chosen row. Keys read the ref, which changes at once.
   */
  type Open = { request: PickRequest; items?: PickItem[]; note?: string; filter: string; index: number };
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
  /** The row of the choice in use, so the list opens on it. */
  const startAt = (items: PickItem[]) => Math.max(0, items.findIndex((item) => item.current));
  const pick = (request: PickRequest) => {
    const items = Array.isArray(request.items) ? request.items : undefined;
    setOverlay({ request, filter: '', index: items ? startAt(items) : 0, ...(items ? { items } : {}) });
    if (items) return;
    const pending = request.items as Promise<{ items: PickItem[]; note?: string }>;
    const still = () => overlay.current?.request === request;
    pending.then(
      (arrived) => still() && setOverlay({ ...overlay.current!, items: arrived.items, index: startAt(arrived.items), ...(arrived.note ? { note: arrived.note } : {}) }),
      (error) => still() && setOverlay({ ...overlay.current!, items: [], note: error?.message ?? String(error) })
    );
  };

  const say = (level: 'info' | 'warn' | 'error', text: string) => dispatch({ type: 'notice', level, text });
  const context = (): CommandContext => ({
    runtime,
    projectRoot,
    running: controller.running,
    ...(profile.current ? { profile: profile.current } : {}),
    show: (text) => dispatch({ type: 'output', text }),
    notice: say,
    dispatch,
    refresh: () => controller.refresh(),
    openSession: switchSession,
    setMode: (mode) => void controller.setMode(mode),
    confirmBypass: () => setConfirmBypass(true),
    copy: (text) => renderer.copyToClipboardOSC52(text),
    exit: onExit,
    commands: () => commands,
    pick,
    theme,
    setTheme,
    statusStyle,
    setStatusStyle,
    prefill: (text) => {
      composer.current?.setText(text);
      composer.current?.gotoBufferEnd();
    },
    send: (prompt, options) => void controller.submit(prompt, options),
    keys: keys.bindings,
  });

  // An MCP server's request for input is asked in an overlay, with the context as it is then.
  controller.onElicitation = (event) => answerElicitation(context(), event);

  /** Search what the person has sent before, and put the chosen message in the composer. */
  const openHistory = () =>
    pick({
      title: 'Earlier messages, newest first',
      items: earlierMessages(projectRoot, { id: runtime.sessionId, messages: runtime.session.messages }),
      empty: 'Nothing sent yet in this project.',
      hint: 'Enter puts it in the composer',
      choose: (item) => {
        composer.current?.setText(item.value ?? item.label);
        composer.current?.gotoBufferEnd();
      },
    });

  const runCommand = async (line: string, options: { quiet?: boolean } = {}) => {
    const parsed = parseCommand(line);
    if (!parsed) return;
    const command = findCommand(commands, parsed.name);
    // A custom command's line is shown as the message it sends.
    if (!options.quiet && command?.source !== 'user' && command?.source !== 'project') dispatch({ type: 'command', text: line });
    if (!command) return say('warn', LATER.has(parsed.name) ? `/${parsed.name} is not available yet.` : `/${parsed.name} is not a command. /help lists them.`);
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
  const matchesFor = (draft: string) => (naming(draft) && palette.current.closed !== draft ? matchCommands(commands, draft) : undefined);
  const onDraft = () => {
    const draft = composer.current?.plainText ?? '';
    if (draft !== palette.current.draft) setPalette({ draft, index: 0, closed: palette.current.closed === draft ? draft : undefined });
  };
  const matches = matchesFor(palette.current.draft);

  const submit = () => {
    const typed = composer.current?.plainText ?? '';
    const text = typed.trim();
    if (!text) return;
    // Enter on a name still being typed runs the chosen match.
    const listed = matchesFor(typed);
    const chosen = listed?.[palette.current.index];
    const line = listed && chosen && !findCommand(commands, parseCommand(text)?.name ?? '') ? `/${chosen.name}` : text;
    composer.current?.setText('');
    setPalette({ draft: '', index: 0 });
    if (line.startsWith('/')) return void runCommand(line);
    void controller.submit(text);
  };

  useKeyboard((key) => {
    if (bound('exit', key)) {
      if (controller.running) {
        controller.cancel();
        return;
      }
      if (exitArmed) return onExit();
      setExitArmed(true);
      dispatch({ type: 'notice', level: 'info', text: `Press ${keysFor(keys.bindings, 'exit')} again to exit.` });
      setTimeout(() => setExitArmed(false), 2_000);
      return;
    }
    if (confirmBypass) {
      if (key.name === 'escape') {
        setConfirmBypass(false);
        dispatch({ type: 'notice', level: 'info', text: 'Bypass mode was not turned on.' });
      }
      return;
    }
    if (approval) {
      const now = selection();
      const pattern = approval.suggestions[now.selected];
      if (key.name === 'escape') answer({ allow: false });
      else if (now.feedback) return;
      else if (key.name === '1' || key.name === 'y') answer({ allow: true, scope: 'once' });
      else if (key.name === '2' && pattern) answer({ allow: true, scope: 'session', pattern });
      else if (key.name === '3' && pattern) answer({ allow: true, scope: 'project', pattern });
      else if (key.name === '4' || key.name === 'n') choose(() => ({ feedback: true }));
      else if (key.name === 'down') choose((from) => ({ selected: Math.min(from.selected + 1, Math.max(0, approval.suggestions.length - 1)) }));
      else if (key.name === 'up') choose((from) => ({ selected: Math.max(0, from.selected - 1) }));
      return;
    }
    const open = overlay.current;
    if (open) {
      // The overlay takes every key, including the Enter that closes it and hands focus back.
      key.preventDefault();
      const shown = open.items ? shownItems(open.items, open.filter, open.request.freeText) : [];
      const last = Math.max(0, shown.length - 1);
      const step = { down: 1, up: -1, pagedown: PICKER_ROWS, pageup: -PICKER_ROWS }[key.name as 'down'];
      if (key.name === 'escape') {
        setOverlay(undefined);
        open.request.dismissed?.();
      }
      else if (step) setOverlay({ ...open, index: Math.min(Math.max(0, open.index + step), last) });
      else if (key.name === 'return') {
        const item = shown[open.index];
        if (!item) return;
        setOverlay(undefined);
        Promise.resolve(open.request.choose(item)).catch((error: any) => say('error', error?.message ?? String(error)));
      } else if (key.name === 'backspace') setOverlay({ ...open, filter: open.filter.slice(0, -1), index: 0 });
      else if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1 && key.sequence >= ' ') setOverlay({ ...open, filter: open.filter + key.sequence, index: 0 });
      return;
    }
    const draft = composer.current?.plainText ?? '';
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
        return setPalette({ draft, index: 0, closed: draft });
      }
    }
    const up = bound('page_up', key);
    if (up || bound('page_down', key)) {
      key.preventDefault();
      const box = transcript.current;
      if (!box) return;
      anchor.current = undefined;
      if (up && box.scrollTop <= 0 && hidden > 0) {
        anchor.current = { fromBottom: box.scrollHeight - box.scrollTop, until: Date.now() + ANCHOR_MS };
        return setDrawn((count) => count + TRANSCRIPT_ROWS);
      }
      return box.scrollBy(up ? -1 : 1, 'viewport');
    }
    if (bound('interrupt', key) && controller.running) {
      controller.cancel();
      return;
    }
    if (bound('cycle_mode', key)) {
      key.preventDefault();
      controller.cycleMode();
      return;
    }
    if (bound('tool_detail', key)) {
      const last = [...state.rows].reverse().find((row) => row.kind === 'tool');
      if (last) dispatch({ type: 'toggle', id: last.id });
      return;
    }
    if (bound('history', key)) {
      key.preventDefault();
      return openHistory();
    }
    if (bound('todos', key)) {
      key.preventDefault();
      return setShowTodos((shown) => !shown);
    }
    if (bound('redraw', key)) renderer.requestRender();
  });

  const chords = (action: KeyAction, submitAs: 'submit' | 'newline') =>
    keys.bindings[action].filter((chord) => chord.name.length > 1 || /[a-z]/.test(chord.name)).map((chord) => ({ name: chord.name, ctrl: chord.ctrl, shift: chord.shift, meta: chord.meta, action: submitAs }));

  const plain = screenReader;
  const status = statusParts(state.status);
  // The indicator moves while JamCLI works, not while it waits for the person. Screen
  // reader mode implies reduced motion, so it never draws there.
  const moving = !reducedMotion && WORKING.has(state.status.phase);
  return (
    <ThemeContext.Provider value={theme}>
      <PlainContext.Provider value={plain}>
        <MotionContext.Provider value={reducedMotion}>
          <box flexDirection="column" width="100%" height="100%">
            <box height={1} flexShrink={0}>
              <text fg={theme.dim}>{`${plain ? 'JamCLI, project ' : 'jamcli · '}${path.basename(projectRoot)}${branch ? `${plain ? ', branch ' : ' · '}${branch}` : ''}${plain ? ', session ' : ' · session '}${runtime.sessionId}`}</text>
            </box>
            <scrollbox ref={transcript} flexGrow={1} stickyScroll stickyStart="bottom" viewportCulling {...(plain ? { verticalScrollbarOptions: { visible: false } } : {})}>
              {hidden ? (
                <text fg={theme.dim}>{`${plain ? 'Note: ' : ''}${hidden} earlier row${hidden === 1 ? ' is' : 's are'} not drawn. ${keysFor(keys.bindings, 'page_up')} at the top draws ${Math.min(hidden, TRANSCRIPT_ROWS)} more.`}</text>
              ) : null}
              {(hidden ? state.rows.slice(hidden) : state.rows).map((row) => (
                <RowView key={row.id} row={row} syntax={syntax} />
              ))}
            </scrollbox>
            {approval ? (
              <PermissionPrompt
                approval={approval}
                queued={state.approvals.length}
                syntax={syntax}
                file={(state.rows.find((row) => row.kind === 'tool' && row.callId === approval.callId) as { path?: string } | undefined)?.path}
                selected={selected}
                feedback={feedback}
                onFeedback={(text) => answer({ allow: false, ...(text.trim() ? { feedback: text.trim() } : {}) })}
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
              <box flexDirection="column" flexShrink={0}>
                {overlay.current ? (
                  <Picker
                    title={overlay.current.request.title}
                    items={overlay.current.items}
                    note={overlay.current.note ?? overlay.current.request.note}
                    empty={overlay.current.request.empty}
                    hint={overlay.current.request.hint}
                    filter={overlay.current.filter}
                    selected={overlay.current.index}
                    {...(overlay.current.request.freeText !== undefined ? { freeText: overlay.current.request.freeText } : {})}
                  />
                ) : matches ? (
                  <Palette matches={matches} selected={palette.current.index} />
                ) : null}
                {showTodos ? <TodoPanel todos={state.todos} plain={plain} colors={theme} /> : null}
                <box {...framed(plain, theme.border)} paddingLeft={0} paddingRight={0} flexShrink={0} height={plain ? 3 : 5}>
                  <textarea
                    ref={composer}
                    focused={!overlay.current}
                    textColor={theme.text}
                    focusedTextColor={theme.text}
                    placeholderColor={theme.dim}
                    cursorColor={theme.text}
                    placeholder={`${plain ? 'Message: ' : ''}Message JamCLI. ${keysFor(keys.bindings, 'send')} sends, ${keysFor(keys.bindings, 'newline')} adds a line, / lists commands.`}
                    keyBindings={[...chords('send', 'submit'), ...chords('newline', 'newline')]}
                    onSubmit={submit}
                    onContentChange={onDraft}
                  />
                </box>
              </box>
            )}
            <box height={1} flexShrink={0} flexDirection="row">
              {moving ? <Indicator style={statusStyle} words={status.at(-1)!} /> : null}
              <text fg={state.status.mode === 'bypass' ? theme.error : theme.dim}>{`${plain ? 'Status: ' : ''}${(moving ? status.slice(0, -1) : status).join(plain ? ', ' : ' · ')}`}</text>
            </box>
          </box>
        </MotionContext.Provider>
      </PlainContext.Provider>
    </ThemeContext.Provider>
  );
}
