/** @jsxImportSource @opentui/react */
import path from 'path';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useKeyboard, useRenderer } from '@opentui/react';
import type { TextareaRenderable } from '@opentui/core';
import type { Runtime } from '../../core/runtime/index.js';
import { initialView, reduceView, type ViewState } from '../state/view.js';
import { SessionController, gitBranch } from './controller.js';
import { statusParts } from './format.js';
import { createSyntaxStyle } from './syntax.js';
import { BUILTIN_COMMANDS, findCommand, matchCommands, parseCommand, type CommandContext, type SessionChoice, type SlashCommand } from './commands.js';
import { Palette } from './Palette.js';
import { Picker, filterItems, PICKER_ROWS, type PickItem, type PickRequest } from './Picker.js';
import { THEMES, ThemeContext, type Theme } from './theme.js';
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
const LATER = new Set(['rewind', 'undo', 'diff', 'commit', 'pr', 'skills', 'hooks', 'plugins', 'workflows']);

export function App({ runtime: first, projectRoot, onExit, openSession: open, commands: extra = [], theme: startTheme = THEMES.dark }: AppProps) {
  const renderer = useRenderer();
  const [state, dispatch] = useReducer(reduceView, undefined, (): ViewState => initialView());
  const [runtime, setRuntime] = useState(first);
  const controller = useMemo(() => new SessionController(runtime, dispatch), [runtime]);
  const commands = useMemo(() => [...BUILTIN_COMMANDS, ...extra], [extra]);
  const composer = useRef<TextareaRenderable | null>(null);
  const [exitArmed, setExitArmed] = useState(false);
  const branch = useMemo(() => gitBranch(projectRoot), [projectRoot]);
  const [theme, setTheme] = useState<Theme>(startTheme);
  const syntax = useMemo(() => createSyntaxStyle(theme), [theme]);
  useEffect(() => () => syntax.destroy(), [syntax]);

  useEffect(() => {
    controller.refresh();
    for (const notice of runtime.notices) dispatch({ type: 'notice', level: 'warn', text: notice });
  }, [controller, runtime]);

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
    prefill: (text) => {
      composer.current?.setText(text);
      composer.current?.gotoBufferEnd();
    },
  });

  const runCommand = async (line: string, options: { quiet?: boolean } = {}) => {
    const parsed = parseCommand(line);
    if (!parsed) return;
    if (!options.quiet) dispatch({ type: 'command', text: line });
    const command = findCommand(commands, parsed.name);
    if (!command) return say('warn', LATER.has(parsed.name) ? `/${parsed.name} is not available yet.` : `/${parsed.name} is not a command. /help lists them.`);
    try {
      await command.run(context(), parsed.args);
    } catch (error: any) {
      say('error', `/${command.name} failed: ${error?.message ?? error}`);
    }
  };

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
    if (key.ctrl && key.name === 'c') {
      if (controller.running) {
        controller.cancel();
        return;
      }
      if (exitArmed) return onExit();
      setExitArmed(true);
      dispatch({ type: 'notice', level: 'info', text: 'Press Ctrl+C again to exit.' });
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
      const shown = open.items ? filterItems(open.items, open.filter) : [];
      const last = Math.max(0, shown.length - 1);
      const step = { down: 1, up: -1, pagedown: PICKER_ROWS, pageup: -PICKER_ROWS }[key.name as 'down'];
      if (key.name === 'escape') setOverlay(undefined);
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
    // ? on an empty composer lists the commands and keys.
    if (key.sequence === '?' && draft === '') {
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
    if (key.name === 'escape' && controller.running) {
      controller.cancel();
      return;
    }
    if (key.name === 'tab' && key.shift) {
      controller.cycleMode();
      return;
    }
    if (key.ctrl && key.name === 'o') {
      const last = [...state.rows].reverse().find((row) => row.kind === 'tool');
      if (last) dispatch({ type: 'toggle', id: last.id });
      return;
    }
    if (key.ctrl && key.name === 'l') renderer.requestRender();
  });

  return (
    <ThemeContext.Provider value={theme}>
      <box flexDirection="column" width="100%" height="100%">
        <box height={1} flexShrink={0}>
          <text fg={theme.dim}>{`jamcli · ${path.basename(projectRoot)}${branch ? ` · ${branch}` : ''} · session ${runtime.sessionId}`}</text>
        </box>
        <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" viewportCulling>
          {state.rows.map((row) => (
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
              />
            ) : matches ? (
              <Palette matches={matches} selected={palette.current.index} />
            ) : null}
            <box border borderColor={theme.border} flexShrink={0} height={5}>
              <textarea
                ref={composer}
                focused={!overlay.current}
                placeholder="Message JamCLI. Enter sends, Shift+Enter adds a line, / lists commands."
                keyBindings={[
                  { name: 'return', action: 'submit' },
                  { name: 'return', shift: true, action: 'newline' },
                ]}
                onSubmit={submit}
                onContentChange={onDraft}
              />
            </box>
          </box>
        )}
        <box height={1} flexShrink={0}>
          <text fg={state.status.mode === 'bypass' ? theme.error : theme.dim}>{statusParts(state.status).join(' · ')}</text>
        </box>
      </box>
    </ThemeContext.Provider>
  );
}
