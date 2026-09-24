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
  runtime: Runtime;
  projectRoot: string;
  /** Called when the person asks to leave. */
  onExit: () => void;
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
  }
}

function PermissionPrompt({ approval, queued, syntax, file }: { approval: PendingApproval; queued: number; syntax: SyntaxStyle; file?: string }) {
  const preview = approval.preview?.kind === 'diff' ? undefined : approval.preview?.text.split('\n').slice(0, 12).join('\n');
  return (
    <box border borderColor={THEME.warn} flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
      <text fg={THEME.warn}>{`Allow ${approval.summary}?${queued > 1 ? ` (1 of ${queued})` : ''}`}</text>
      <text fg={THEME.dim}>{`Asked because ${approval.reason}.`}</text>
      {approval.preview?.kind === 'diff' ? <DiffView diff={approval.preview.text} file={file} syntax={syntax} /> : null}
      {preview ? <text>{preview}</text> : null}
      <text>1 allow once · 4 or Escape deny</text>
    </box>
  );
}

export function App({ runtime, projectRoot, onExit }: AppProps) {
  const renderer = useRenderer();
  const [state, dispatch] = useReducer(reduceView, undefined, (): ViewState => initialView());
  const controller = useMemo(() => new SessionController(runtime, dispatch), [runtime]);
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

  const submit = useCallback(() => {
    const text = composer.current?.plainText.trim() ?? '';
    if (!text) return;
    composer.current?.setText('');
    if (text === '/exit' || text === '/quit') return onExit();
    if (text === '/clear') return dispatch({ type: 'clear' });
    if (text.startsWith('/')) {
      dispatch({ type: 'notice', level: 'warn', text: `${text.split(/\s/)[0]} is not available in this interface yet.` });
      return;
    }
    void controller.submit(text);
  }, [controller, onExit]);

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
    if (approval) {
      if (key.name === '1' || key.name === 'y') controller.answer(approval.callId, { allow: true, scope: 'once' });
      else if (key.name === '4' || key.name === 'n' || key.name === 'escape') controller.answer(approval.callId, { allow: false });
      return;
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
        />
      ) : (
        <box border borderColor={THEME.border} flexShrink={0} height={5}>
          <textarea
            ref={composer}
            focused
            placeholder="Message JamCLI. Enter sends, Shift+Enter adds a line."
            keyBindings={[
              { name: 'return', action: 'submit' },
              { name: 'return', shift: true, action: 'newline' },
            ]}
            onSubmit={submit}
          />
        </box>
      )}
      <box height={1} flexShrink={0}>
        <text fg={THEME.dim}>{statusParts(state.status).join(' · ')}</text>
      </box>
    </box>
  );
}
