/** @jsxImportSource @opentui/react */
import type { MarkdownRenderable, SyntaxStyle } from '@opentui/core';
import { useEffect, useRef } from 'react';
import type { Row } from '../state/view.js';
import { compactionLine, noticeLine, thinkingLine, thinkingSize, thinkingWindow, toolLine } from './format.js';
import type { ThinkingSize } from './format.js';
import { useClick } from './mouse.js';
import { filetypeOf } from './syntax.js';
import { usePlain, useSelectable, useTheme, type Selectable } from './theme.js';

/**
 * A unified diff, highlighted as the file it changes. In screen reader mode it is the
 * diff's own text, so every + and - line reads as written.
 */
export function DiffView({ diff, file, syntax }: { diff: string; file?: string; syntax: SyntaxStyle }) {
  const theme = useTheme();
  const sel = useSelectable();
  if (usePlain()) return <text {...sel} fg={theme.text}>{`Diff:\n${diff}`}</text>;
  return (
    <diff
      {...sel}
      diff={diff}
      view="unified"
      filetype={filetypeOf(file)}
      syntaxStyle={syntax}
      showLineNumbers
      wrapMode="word"
      fg={theme.text}
      lineNumberFg={theme.dim}
      addedBg={theme.diff.addedBg}
      removedBg={theme.diff.removedBg}
      addedSignColor={theme.diff.addedSign}
      removedSignColor={theme.diff.removedSign}
    />
  );
}

/** A renderable that can take selection colors: text, code, and the blocks markdown builds from them. */
type Selects = { selectionBg?: unknown; selectionFg?: unknown; getChildren(): Selects[] };

/** Give every text block under a renderable the theme's selection colors. */
function colorSelection(renderable: Selects, colors: Selectable): void {
  for (const child of renderable.getChildren()) {
    if ('selectionBg' in child) {
      child.selectionBg = colors.selectionBg;
      child.selectionFg = colors.selectionFg;
    }
    colorSelection(child, colors);
  }
}

/**
 * A reply as Markdown. The markdown element builds its own text blocks and gives them
 * no selection colors, so after each change of content they are given the theme's.
 */
function MarkdownView({ content, syntax, streaming }: { content: string; syntax: SyntaxStyle; streaming: boolean }) {
  const sel = useSelectable();
  const ref = useRef<MarkdownRenderable>(null);
  useEffect(() => {
    if (ref.current) colorSelection(ref.current as unknown as Selects, sel);
  }, [content, sel.selectionBg, sel.selectionFg]);
  return <markdown ref={ref} content={content} syntaxStyle={syntax} streaming={streaming} conceal />;
}

const NOTICE_LABELS = { info: 'Note', warn: 'Warning', error: 'Error' } as const;

/** A row as plain labeled lines, for screen reader mode: who or what, then the words. */
function PlainRow({ row, onToggle }: { row: Row; onToggle?: (id: number) => void }) {
  const theme = useTheme();
  const sel = useSelectable();
  const click = useClick();
  switch (row.kind) {
    case 'user':
      return <text {...sel} fg={theme.text}>{`You: ${row.text}`}</text>;
    case 'assistant': {
      const thinkingShown = !row.collapsed;
      return (
        <box flexDirection="column">
          {/* The live window is a moving picture, so plain mode says only that thinking is under way. */}
          {row.reasoning && row.streaming && !row.text ? <text {...sel} fg={theme.text}>Thinking...</text> : null}
          {row.reasoning && (row.text || !row.streaming) ? (
            <text {...sel} fg={theme.text} onMouseUp={click(() => onToggle?.(row.id))}>{`${thinkingLine(row.reasoning, thinkingShown, false)}, ${thinkingShown ? 'shown' : 'hidden'}`}</text>
          ) : null}
          {row.reasoning && thinkingShown ? <text {...sel} fg={theme.text}>{`Thinking: ${row.reasoning}`}</text> : null}
          {row.text ? <text {...sel} fg={theme.text}>{`JamCLI: ${row.text}`}</text> : null}
        </box>
      );
    }
    case 'tool':
      return (
        <box flexDirection="column">
          <text {...sel} fg={theme.text} onMouseUp={click(() => onToggle?.(row.id))}>{`Tool ${toolLine(row, false)}`}</text>
          {!row.collapsed && row.diff ? <text {...sel} fg={theme.text}>{`Diff:\n${row.diff}`}</text> : null}
          {!row.collapsed && !row.diff && row.output ? <text {...sel} fg={theme.text}>{`Output:\n${row.output}`}</text> : null}
        </box>
      );
    case 'notice':
      return <text {...sel} fg={theme.text}>{`${NOTICE_LABELS[row.level]}: ${row.text}`}</text>;
    case 'compaction':
      return <text {...sel} fg={theme.text}>{`Note: ${compactionLine(row)}`}</text>;
    case 'command':
      return <text {...sel} fg={theme.text}>{`Command: ${row.text}`}</text>;
    case 'output':
      return (
        <box flexDirection="column">
          <text {...sel} fg={theme.text}>{`Result: ${row.text}`}</text>
          {row.diff ? <text {...sel} fg={theme.text}>{`Diff:\n${row.diff}`}</text> : null}
        </box>
      );
  }
}

/** One transcript row. A tool's line opens and closes its output when clicked, and a thinking line its thinking. */
export function RowView({
  row,
  syntax,
  onToggle,
  thinking = thinkingSize(undefined, 80),
}: {
  row: Row;
  syntax: SyntaxStyle;
  onToggle?: (id: number) => void;
  thinking?: ThinkingSize;
}) {
  const theme = useTheme();
  const sel = useSelectable();
  const click = useClick();
  if (usePlain()) return <PlainRow row={row} onToggle={onToggle} />;
  switch (row.kind) {
    case 'user':
      return (
        <box marginTop={1}>
          <text {...sel} fg={theme.user}>{`> ${row.text}`}</text>
        </box>
      );
    case 'assistant': {
      // Thinking arrives fast and in bursts. It runs in a window of a fixed height and a
      // fixed width so the transcript above it stays still, and leaves one line behind
      // once the answer starts or the turn ends. A click on that line shows all of it.
      const live = Boolean(row.reasoning) && row.streaming && !row.text;
      const thinkingShown = !row.collapsed;
      return (
        <box flexDirection="column">
          {live ? (
            <box width={thinking.width} height={thinking.lines} flexShrink={0}>
              <text {...sel} fg={theme.dim}>{thinkingWindow(row.reasoning, thinking)}</text>
            </box>
          ) : row.reasoning ? (
            <box flexDirection="column">
              <text {...sel} fg={theme.dim} onMouseUp={click(() => onToggle?.(row.id))}>
                {thinkingLine(row.reasoning, thinkingShown)}
              </text>
              {thinkingShown ? <text {...sel} fg={theme.dim}>{row.reasoning}</text> : null}
            </box>
          ) : null}
          {row.text ? <MarkdownView content={row.text} syntax={syntax} streaming={Boolean(row.streaming)} /> : null}
        </box>
      );
    }
    case 'tool':
      return (
        <box flexDirection="column">
          <text {...sel} fg={row.phase === 'error' || row.phase === 'timeout' ? theme.error : row.phase === 'denied' ? theme.warn : theme.accent} onMouseUp={click(() => onToggle?.(row.id))}>
            {toolLine(row)}
          </text>
          {!row.collapsed && row.diff ? <DiffView diff={row.diff} file={row.path} syntax={syntax} /> : null}
          {!row.collapsed && !row.diff && row.output ? <text {...sel} fg={theme.dim}>{row.output}</text> : null}
        </box>
      );
    case 'notice':
      return <text {...sel} fg={row.level === 'error' ? theme.error : row.level === 'warn' ? theme.warn : theme.dim}>{noticeLine(row)}</text>;
    case 'compaction':
      return <text {...sel} fg={theme.dim}>{compactionLine(row)}</text>;
    case 'command':
      return (
        <box marginTop={1}>
          <text {...sel} fg={theme.accent}>{`> ${row.text}`}</text>
        </box>
      );
    case 'output':
      return (
        <box flexDirection="column">
          <text {...sel} fg={theme.text}>{row.text}</text>
          {row.diff ? <DiffView diff={row.diff} syntax={syntax} /> : null}
        </box>
      );
  }
}
