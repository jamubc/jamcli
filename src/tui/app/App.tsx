/** @jsxImportSource @opentui/react */
import path from 'path';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useKeyboard, useRenderer } from '@opentui/react';
import type { SyntaxStyle, TextareaRenderable } from '@opentui/core';
import type { Runtime } from '../../core/runtime/index.js';
import { initialView, reduceView, type PendingApproval, type Row, type ViewState } from '../state/view.js';
import { SessionController, gitBranch } from './controller.js';
import { compactionLine, noticeLine, statusParts, toolLine } from './format.js';
import { createSyntaxStyle, filetypeOf } from './syntax.js';
import { BUILTIN_COMMANDS, findCommand, matchCommands, parseCommand, type CommandContext, type SessionChoice, type SlashCommand } from './commands.js';
import { Palette } from './Palette.js';

/** Colors by role. Every state also has a word, so none of these carries meaning alone. */
export const THEME = {
  dim: '#7a7f8c',
  user: '#9ece6a',
  accent: '#7aa2f7',
  warn: '#e0af68',
  error: '#f7768e',
  border: '#3b4261',
};

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
}

/** A unified diff, highlighted as the file it changes. */
function DiffView({ diff, file, syntax }: { diff: string; file?: string; syntax: SyntaxStyle }) {
  return <diff diff={diff} view="unified" filetype={filetypeOf(file)} syntaxStyle={syntax} showLineNumbers wrapMode="word" />;
}

function RowView({ row, syntax }: { row: Row; syntax: SyntaxStyle }) {
  switch (row.kind) {
    case 'user':
      return (
        <box marginTop={1}>
          <text fg={THEME.user}>{`> ${row.text}`}</text>
        </box>
      );
    case 'assistant':
      return (
        <box flexDirection="column">
          {row.reasoning ? <text fg={THEME.dim}>{`thinking: ${row.streaming && !row.text ? row.reasoning.slice(-200) : row.reasoning.split('\n')[0].slice(0, 120)}`}</text> : null}
          {row.text ? <markdown content={row.text} syntaxStyle={syntax} streaming={row.streaming} conceal /> : null}
        </box>
      );
    case 'tool':
      return (
        <box flexDirection="column">
          <text fg={row.phase === 'error' || row.phase === 'timeout' ? THEME.error : row.phase === 'denied' ? THEME.warn : THEME.accent}>{toolLine(row)}</text>
          {!row.collapsed && row.diff ? <DiffView diff={row.diff} file={row.path} syntax={syntax} /> : null}
          {!row.collapsed && !row.diff && row.output ? <text fg={THEME.dim}>{row.output}</text> : null}
        </box>
      );
    case 'notice':
      return <text fg={row.level === 'error' ? THEME.error : row.level === 'warn' ? THEME.warn : THEME.dim}>{noticeLine(row)}</text>;
    case 'compaction':
      return <text fg={THEME.dim}>{compactionLine(row)}</text>;
    case 'command':
      return (
        <box marginTop={1}>
          <text fg={THEME.accent}>{`> ${row.text}`}</text>
        </box>
      );
    case 'output':
      return <text>{row.text}</text>;
  }
}

/** The pattern a prompt offers, by its place among the suggestions, and whether it is taking feedback. */
interface PromptSelection {
  callId?: string;
  selected: number;
  feedback: boolean;
}

/** An input's submitted text: OpenTUI's React input hands over the value itself. */
const submitted = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The permission prompt, which replaces the composer while a call waits: the action, its
 * preview, why it asked, and the four choices of D6. A deny can carry feedback for the
 * model, typed on a line of its own.
 */
function PermissionPrompt(props: {
  approval: PendingApproval;
  queued: number;
  syntax: SyntaxStyle;
  file?: string;
  selected: number;
  feedback: boolean;
  onFeedback: (text: string) => void;
}) {
  const { approval, queued, syntax, file, selected, feedback } = props;
  const preview = approval.preview?.kind === 'diff' ? undefined : approval.preview?.text.split('\n').slice(0, 12).join('\n');
  const pattern = approval.suggestions[selected];
  const others = approval.suggestions.length > 1 ? ` (${selected + 1} of ${approval.suggestions.length}; Up and Down choose)` : '';
  return (
    <box border borderColor={THEME.warn} flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
      <text fg={THEME.warn}>{`Allow ${approval.summary}?${queued > 1 ? ` (1 of ${queued} waiting)` : ''}`}</text>
      <text fg={THEME.dim}>{`Asked because ${approval.reason}.`}</text>
      {approval.preview?.kind === 'diff' ? <DiffView diff={approval.preview.text} file={file} syntax={syntax} /> : null}
      {preview ? <text>{preview}</text> : null}
      {feedback ? (
        <box flexDirection="column">
          <text>Tell the model what to do instead, or press Enter to just deny:</text>
          <input focused placeholder="feedback for the model" onSubmit={(value: unknown) => props.onFeedback(submitted(value))} />
        </box>
      ) : (
        <box flexDirection="column">
          <text>1 allow once</text>
          {pattern ? <text>{`2 allow ${pattern} for this session${others}`}</text> : null}
          {pattern ? <text>{`3 allow ${pattern} for this project, saved in .jamcli/config.local.json`}</text> : null}
          <text>4 deny, and say why · Escape denies</text>
        </box>
      )}
    </box>
  );
}

/** Asks the person to type yes before bypass mode turns on. */
function BypassConfirm({ onAnswer }: { onAnswer: (text: string) => void }) {
  return (
    <box border borderColor={THEME.error} flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
      <text fg={THEME.error}>Turn on bypass mode?</text>
      <text>Nothing will ask before it runs: every edit and every command goes ahead, and only deny rules stop a call.</text>
      <text>Type yes and press Enter to turn it on. Anything else, or Escape, leaves the mode as it is.</text>
      <input focused placeholder="yes" onSubmit={(value: unknown) => onAnswer(submitted(value))} />
    </box>
  );
}

/** A composer line that starts with a slash and has no space yet is a command being named. */
const naming = (draft: string) => draft.startsWith('/') && !/\s/.test(draft);

/** Commands the design names that arrive with later work. Typing one says so rather than calling it unknown. */
const LATER = new Set(['rewind', 'undo', 'diff', 'commit', 'pr', 'skills', 'hooks', 'plugins', 'workflows', 'theme']);

export function App({ runtime: first, projectRoot, onExit, openSession: open, commands: extra = [] }: AppProps) {
  const renderer = useRenderer();
  const [state, dispatch] = useReducer(reduceView, undefined, (): ViewState => initialView());
  const [runtime, setRuntime] = useState(first);
  const controller = useMemo(() => new SessionController(runtime, dispatch), [runtime]);
  const commands = useMemo(() => [...BUILTIN_COMMANDS, ...extra], [extra]);
  const composer = useRef<TextareaRenderable | null>(null);
  const [exitArmed, setExitArmed] = useState(false);
  const branch = useMemo(() => gitBranch(projectRoot), [projectRoot]);
  const syntax = useMemo(() => createSyntaxStyle(), []);
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
  });

  const runCommand = async (line: string) => {
    const parsed = parseCommand(line);
    if (!parsed) return;
    dispatch({ type: 'command', text: line });
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
    const draft = composer.current?.plainText ?? '';
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
    <box flexDirection="column" width="100%" height="100%">
      <box height={1} flexShrink={0}>
        <text fg={THEME.dim}>{`jamcli · ${path.basename(projectRoot)}${branch ? ` · ${branch}` : ''} · session ${runtime.sessionId}`}</text>
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
          {matches ? <Palette matches={matches} selected={palette.current.index} colors={THEME} /> : null}
          <box border borderColor={THEME.border} flexShrink={0} height={5}>
            <textarea
              ref={composer}
              focused
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
        <text fg={state.status.mode === 'bypass' ? THEME.error : THEME.dim}>{statusParts(state.status).join(' · ')}</text>
      </box>
    </box>
  );
}
