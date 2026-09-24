/** @jsxImportSource @opentui/react */
import type { SyntaxStyle } from '@opentui/core';
import type { Row } from '../state/view.js';
import { compactionLine, noticeLine, toolLine } from './format.js';
import { filetypeOf } from './syntax.js';
import { useTheme } from './theme.js';

/** A unified diff, highlighted as the file it changes. */
export function DiffView({ diff, file, syntax }: { diff: string; file?: string; syntax: SyntaxStyle }) {
  return <diff diff={diff} view="unified" filetype={filetypeOf(file)} syntaxStyle={syntax} showLineNumbers wrapMode="word" />;
}

export function RowView({ row, syntax }: { row: Row; syntax: SyntaxStyle }) {
  const theme = useTheme();
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
