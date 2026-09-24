/** @jsxImportSource @opentui/react */
import { RGBA, type SyntaxStyle } from '@opentui/core';
import type { Row } from '../state/view.js';
import { compactionLine, noticeLine, toolLine } from './format.js';
import { filetypeOf } from './syntax.js';
import { usePlain, useTheme } from './theme.js';

/** A theme color, where `default` is the terminal's own. */
const color = (value: string) => (value === 'default' ? RGBA.defaultForeground() : value);

/**
 * A unified diff, highlighted as the file it changes. In screen reader mode it is the
 * diff's own text, so every + and - line reads as written.
 */
export function DiffView({ diff, file, syntax }: { diff: string; file?: string; syntax: SyntaxStyle }) {
  const theme = useTheme();
  if (usePlain()) return <text>{`Diff:\n${diff}`}</text>;
  return (
    <diff
      diff={diff}
      view="unified"
      filetype={filetypeOf(file)}
      syntaxStyle={syntax}
      showLineNumbers
      wrapMode="word"
      addedBg={theme.diff.addedBg}
      removedBg={theme.diff.removedBg}
      addedSignColor={color(theme.diff.addedSign)}
      removedSignColor={color(theme.diff.removedSign)}
    />
  );
}

const NOTICE_LABELS = { info: 'Note', warn: 'Warning', error: 'Error' } as const;

/** A row as plain labeled lines, for screen reader mode: who or what, then the words. */
function PlainRow({ row }: { row: Row }) {
  switch (row.kind) {
    case 'user':
      return <text>{`You: ${row.text}`}</text>;
    case 'assistant':
      return (
        <box flexDirection="column">
          {row.reasoning && !row.text ? <text>{`Thinking: ${row.reasoning.slice(-200)}`}</text> : null}
          {row.text ? <text>{`JamCLI: ${row.text}`}</text> : null}
        </box>
      );
    case 'tool':
      return (
        <box flexDirection="column">
          <text>{`Tool ${toolLine(row, false)}`}</text>
          {!row.collapsed && row.diff ? <text>{`Diff:\n${row.diff}`}</text> : null}
          {!row.collapsed && !row.diff && row.output ? <text>{`Output:\n${row.output}`}</text> : null}
        </box>
      );
    case 'notice':
      return <text>{`${NOTICE_LABELS[row.level]}: ${row.text}`}</text>;
    case 'compaction':
      return <text>{`Note: ${compactionLine(row)}`}</text>;
    case 'command':
      return <text>{`Command: ${row.text}`}</text>;
    case 'output':
      return <text>{`Result: ${row.text}`}</text>;
  }
}

export function RowView({ row, syntax }: { row: Row; syntax: SyntaxStyle }) {
  const theme = useTheme();
  if (usePlain()) return <PlainRow row={row} />;
  switch (row.kind) {
    case 'user':
      return (
        <box marginTop={1}>
          <text fg={theme.user}>{`> ${row.text}`}</text>
        </box>
      );
    case 'assistant':
      return (
        <box flexDirection="column">
          {row.reasoning ? <text fg={theme.dim}>{`thinking: ${row.streaming && !row.text ? row.reasoning.slice(-200) : row.reasoning.split('\n')[0].slice(0, 120)}`}</text> : null}
          {row.text ? <markdown content={row.text} syntaxStyle={syntax} streaming={row.streaming} conceal /> : null}
        </box>
      );
    case 'tool':
      return (
        <box flexDirection="column">
          <text fg={row.phase === 'error' || row.phase === 'timeout' ? theme.error : row.phase === 'denied' ? theme.warn : theme.accent}>{toolLine(row)}</text>
          {!row.collapsed && row.diff ? <DiffView diff={row.diff} file={row.path} syntax={syntax} /> : null}
          {!row.collapsed && !row.diff && row.output ? <text fg={theme.dim}>{row.output}</text> : null}
        </box>
      );
    case 'notice':
      return <text fg={row.level === 'error' ? theme.error : row.level === 'warn' ? theme.warn : theme.dim}>{noticeLine(row)}</text>;
    case 'compaction':
      return <text fg={theme.dim}>{compactionLine(row)}</text>;
    case 'command':
      return (
        <box marginTop={1}>
          <text fg={theme.accent}>{`> ${row.text}`}</text>
        </box>
      );
    case 'output':
      return <text>{row.text}</text>;
  }
}
