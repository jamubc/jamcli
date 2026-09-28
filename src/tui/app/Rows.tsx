/** @jsxImportSource @opentui/react */
import type { MarkdownRenderable, SyntaxStyle } from '@opentui/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Row } from '../state/view.js';
import { closeMarkers, compactionLine, noticeLine, thinkingLine, thinkingSize, toolLine } from './format.js';
import type { ThinkingSize } from './format.js';
import { useClickable } from './mouse.js';
import { filetypeOf } from './syntax.js';
import { chosenRow, usePlain, useSelectable, useTheme, type Selectable } from './theme.js';

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
 * A reply as Markdown. While it streams, the markers it has opened are closed for it, so
 * a word is bold or code from its first character rather than jumping once its closer
 * arrives. The markdown element builds its own text blocks and gives them no selection
 * colors, so after each change of content they are given the theme's.
 */
function MarkdownView({ content, syntax, streaming }: { content: string; syntax: SyntaxStyle; streaming: boolean }) {
  const sel = useSelectable();
  const ref = useRef<MarkdownRenderable>(null);
  const shown = streaming ? closeMarkers(content) : content;
  useEffect(() => {
    if (ref.current) colorSelection(ref.current as unknown as Selects, sel);
  }, [shown, sel.selectionBg, sel.selectionFg]);
  return <markdown ref={ref} content={shown} syntaxStyle={syntax} streaming={streaming} conceal />;
}

/** The rail a block's detail sits behind, so it reads as an aside to the line above it. */
function Rail({ children, width }: { children: ReactNode; width?: number }) {
  const theme = useTheme();
  return (
    <box border={['left']} borderColor={theme.dim} paddingLeft={1} flexShrink={0} {...(width !== undefined ? { width } : {})}>
      {children}
    </box>
  );
}

const NOTICE_LABELS = { info: 'Note', warn: 'Warning', error: 'Error' } as const;

/** A row as plain labeled lines, for screen reader mode: who or what, then the words. */
function PlainRow({ row, onToggle, open }: { row: Row; onToggle?: (id: number) => void; open: boolean }) {
  const theme = useTheme();
  const sel = useSelectable();
  const clickable = useClickable();
  const toggles = clickable(() => onToggle?.(row.id));
  switch (row.kind) {
    case 'user':
      return <text {...sel} fg={theme.text}>{`You: ${row.text}`}</text>;
    case 'assistant': {
      const thinkingShown = open;
      return (
        <box flexDirection="column">
          {/* The live window is a moving picture, so plain mode says only that thinking is under way. */}
          {row.reasoning && row.streaming && !row.text ? <text {...sel} fg={theme.text}>Thinking...</text> : null}
          {row.reasoning && (row.text || !row.streaming) ? (
            <text {...sel} fg={theme.text} {...toggles}>{`${thinkingLine(row.reasoning, thinkingShown, false)}, ${thinkingShown ? 'shown' : 'hidden'}`}</text>
          ) : null}
          {row.reasoning && thinkingShown ? <text {...sel} fg={theme.text}>{`Thinking: ${row.reasoning}`}</text> : null}
          {row.text ? <text {...sel} fg={theme.text}>{`JamCLI: ${row.text}`}</text> : null}
        </box>
      );
    }
    case 'tool':
      return (
        <box flexDirection="column">
          <text {...sel} fg={theme.text} {...toggles}>{`Tool ${toolLine(row, false)}`}</text>
          {open && row.diff ? <text {...sel} fg={theme.text}>{`Diff:\n${row.diff}`}</text> : null}
          {open && !row.diff && row.output ? <text {...sel} fg={theme.text}>{`Output:\n${row.output}`}</text> : null}
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
  open: shown,
  thinking = thinkingSize(undefined, 80),
}: {
  row: Row;
  syntax: SyntaxStyle;
  onToggle?: (id: number) => void;
  /** Whether the row's thinking, output, or diff shows, over its own state; the detailed transcript opens them all. */
  open?: boolean;
  thinking?: ThinkingSize;
}) {
  const theme = useTheme();
  const sel = useSelectable();
  const clickable = useClickable();
  const [hot, setHot] = useState(false);
  const toggles = { ...clickable(() => onToggle?.(row.id), { over: () => setHot(true), out: () => setHot(false) }), ...chosenRow(theme, hot), width: '100%' as const };
  const open = shown ?? !('collapsed' in row && row.collapsed);
  if (usePlain()) return <PlainRow row={row} onToggle={onToggle} open={open} />;
  switch (row.kind) {
    case 'user':
      return (
        <box marginTop={1}>
          <text {...sel} fg={theme.user}>{`> ${row.text}`}</text>
        </box>
      );
    case 'assistant': {
      // Thinking arrives fast and in bursts. It runs under its own line, in a window of a
      // fixed height and a fixed width so the transcript above it stays still, and folds
      // to that line once the answer starts or the turn ends. A click on the line shows
      // all of it. The two states are keyed apart: reused, the one box would keep the
      // window's fixed height after the window had gone.
      const live = Boolean(row.reasoning) && row.streaming && !row.text;
      const thinkingShown = open;
      return (
        <box flexDirection="column">
          {live ? (
            <box key="live" flexDirection="column" width={thinking.width} flexShrink={0}>
              <text {...sel} fg={theme.dim}>{thinkingLine(row.reasoning, true, true, thinking.width)}</text>
              <Rail>
                <scrollbox height={thinking.lines} stickyScroll stickyStart="bottom" verticalScrollbarOptions={{ visible: false }}>
                  <text {...sel} fg={theme.dim} wrapMode="word">{row.reasoning}</text>
                </scrollbox>
              </Rail>
            </box>
          ) : row.reasoning ? (
            <box key="settled" flexDirection="column">
              <text {...sel} fg={theme.dim} {...toggles}>
                {thinkingLine(row.reasoning, thinkingShown, true, thinking.width)}
              </text>
              {thinkingShown ? (
                <Rail width={thinking.width}>
                  <text {...sel} fg={theme.dim} wrapMode="word">{row.reasoning}</text>
                </Rail>
              ) : null}
            </box>
          ) : null}
          {row.text ? <MarkdownView content={row.text} syntax={syntax} streaming={Boolean(row.streaming)} /> : null}
        </box>
      );
    }
    case 'tool':
      return (
        <box flexDirection="column">
          <text {...sel} fg={row.phase === 'error' || row.phase === 'timeout' ? theme.error : row.phase === 'denied' ? theme.warn : theme.accent} {...toggles}>
            {toolLine(row)}
          </text>
          {open && row.diff ? (
            <Rail>
              <DiffView diff={row.diff} file={row.path} syntax={syntax} />
            </Rail>
          ) : null}
          {open && !row.diff && row.output ? (
            <Rail>
              <text {...sel} fg={theme.dim}>{row.output}</text>
            </Rail>
          ) : null}
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
