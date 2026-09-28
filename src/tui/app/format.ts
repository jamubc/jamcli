import { formatTokens, formatUsd } from '../../core/catalog/cost.js';
import type { Phase, Row, StatusData, ToolPhase } from '../state/view.js';

/**
 * What the interface says, as plain text. Every state has a word as well as a mark, so
 * nothing depends on color, and screen reader mode can drop the marks.
 */

export const TOOL_PHASES: Record<ToolPhase, { mark: string; word: string }> = {
  pending: { mark: '○', word: 'queued' },
  waiting: { mark: '?', word: 'asking' },
  running: { mark: '●', word: 'running' },
  ok: { mark: '✓', word: 'done' },
  error: { mark: '✗', word: 'failed' },
  denied: { mark: '⊘', word: 'denied' },
  timeout: { mark: '⏱', word: 'timed out' },
  cancelled: { mark: '■', word: 'cancelled' },
};

/** One word each: the status line is a row of labels, not a sentence about what is going on. */
export const PHASE_WORDS: Record<Phase, string> = {
  idle: 'ready',
  thinking: 'thinking',
  streaming: 'writing',
  tool: 'running',
  waiting: 'waiting',
  retrying: 'retrying',
  compacting: 'compacting',
};

const NOTICE_MARKS = { info: 'i', warn: '!', error: '✗' } as const;

export const formatDuration = (ms: number | undefined): string =>
  ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;


/** Lines a unified diff adds and removes, not counting its file headers. */
export function diffStat(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return { added, removed };
}

/** The rows a unified diff is drawn in: the lines of its hunks, without the file headers. */
export function diffRows(diff: string): number {
  let rows = 0;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && /^[ +-]/.test(line)) rows += 1;
  }
  return rows;
}

/**
 * The one line a tool block shows when collapsed: the call first, then what it cost. A
 * column of these is read for what ran, so the state is the leading mark rather than a
 * word in front of the call. Screen reader mode has no marks, so there the state is a
 * word at the end, after the facts it belongs to.
 */
export function toolLine(row: Extract<Row, { kind: 'tool' }>, marks = true): string {
  const phase = TOOL_PHASES[row.phase];
  const duration = formatDuration(row.durationMs);
  const stat = row.diff ? diffStat(row.diff) : undefined;
  const decided = row.decision?.by === 'user' ? `${row.decision.allow ? 'allowed' : 'denied'} by you` : undefined;
  if (!marks) {
    const facts = [stat ? `${stat.added} line${stat.added === 1 ? '' : 's'} added and ${stat.removed} removed` : undefined, duration || undefined, phase.word, decided];
    return `${row.summary}, ${facts.filter(Boolean).join(', ')}`;
  }
  const facts = [stat ? `+${stat.added} −${stat.removed}` : undefined, duration || undefined, decided].filter(Boolean);
  return `${phase.mark} ${row.summary}${facts.length ? ` · ${facts.join(' · ')}` : ''}`;
}

export function noticeLine(row: Extract<Row, { kind: 'notice' }>, marks = true): string {
  return `${marks ? `${NOTICE_MARKS[row.level]} ` : ''}${row.level === 'info' ? '' : `${row.level === 'warn' ? 'warning' : 'error'}: `}${row.text}`;
}

export function compactionLine(row: Extract<Row, { kind: 'compaction' }>): string {
  const how = row.strategy === 'summary' ? 'compacted' : 'dropped, summary failed';
  return `${how}${row.trigger === 'auto' ? ' to fit the window' : ''} · ${row.beforeTokens.toLocaleString('en-US')} → ${row.afterTokens.toLocaleString('en-US')} tokens`;
}

/** The status line's parts, left to right. */
/** One fact on the status line, and how soon it is given up when the line does not fit: lowest first, never when absent. */
interface StatusPart {
  text: string;
  drop?: number;
}

function statusEntries(status: StatusData): StatusPart[] {
  const parts: StatusPart[] = [{ text: status.mode === 'bypass' ? 'BYPASS mode' : `${status.mode} mode` }, { text: status.model || 'no model' }];
  if (status.contextPercent !== undefined) parts.push({ text: `context ${Math.round(status.contextPercent)}%`, drop: 7 });
  // Nothing is billed for a free model, so a cost of nothing takes no room; /cost still says it.
  if (status.costUsd !== null && (status.costUsd > 0 || status.unpriced)) parts.push({ text: `${formatUsd(status.costUsd)}${status.unpriced ? '+' : ''}`, drop: 5 });
  else if (status.inputTokens || status.outputTokens) parts.push({ text: 'cost unknown', drop: 5 });
  if (status.inputTokens || status.outputTokens) parts.push({ text: `${formatTokens(status.inputTokens)} in, ${formatTokens(status.outputTokens)} out`, drop: 3 });
  parts.push({ text: status.sandbox === 'none' ? 'no sandbox' : `sandbox ${status.sandbox}`, drop: 4 });
  if (status.mcpServers) parts.push({ text: `MCP ${status.mcpServers}`, drop: 2 });
  if (status.lspServers) parts.push({ text: `LSP ${status.lspServers}`, drop: 1 });
  const phase = status.phase === 'retrying' && status.retry ? `retrying (${status.retry.attempt}): ${status.retry.reason}` : PHASE_WORDS[status.phase];
  parts.push({ text: phase });
  return parts;
}

export function statusParts(status: StatusData): string[] {
  return statusEntries(status).map((part) => part.text);
}

/**
 * The status line fitted to `width`: the least useful facts are given up first, and the
 * mode and what JamCLI is doing never are, so a narrow terminal still says whether it is
 * working or waiting for you. Without the phase when the indicator already shows it.
 */
export function fitStatus(status: StatusData, width: number, options: { separator: string; withoutPhase?: boolean }): string {
  const parts = statusEntries(status);
  if (options.withoutPhase) parts.pop();
  const line = () => parts.map((part) => part.text).join(options.separator);
  while (line().length > width) {
    const droppable = parts.filter((part) => part.drop !== undefined);
    if (!droppable.length) break;
    parts.splice(parts.indexOf(droppable.reduce((least, part) => (part.drop! < least.drop! ? part : least))), 1);
  }
  // Last, the model's name is shortened, since the rest of the line is what changes.
  const over = line().length - width;
  if (over > 0 && parts[1]) parts[1] = { text: `${parts[1].text.slice(0, Math.max(1, parts[1].text.length - over - 1))}…` };
  return line();
}

/** Lines the live thinking window keeps on screen, when nothing else is configured. */
export const THINKING_LINES = 3;
/** Columns the live thinking window wraps to, when nothing else is configured. */
export const THINKING_WIDTH = 72;
/** The narrowest the window wraps to, so a tiny terminal still gives whole words a chance. */
const THINKING_MIN_WIDTH = 20;

/** How large the live thinking window is drawn: its own box, not the transcript's full width. */
export interface ThinkingSize {
  lines: number;
  width: number;
}

/** The configured window, held to at least one line and to the room the terminal has. */
export function thinkingSize(configured: Partial<ThinkingSize> | undefined, available: number): ThinkingSize {
  const width = configured?.width ?? THINKING_WIDTH;
  const lines = configured?.lines ?? THINKING_LINES;
  return { lines: Math.max(1, Math.round(lines)), width: Math.max(THINKING_MIN_WIDTH, Math.min(Math.round(width), available)) };
}

/** One line of thinking, broken at spaces into pieces no wider than `width`. */
function wrapLine(line: string, width: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of line.split(/\s+/)) {
    if (!word) continue;
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current = `${current} ${word}`;
    else {
      out.push(current);
      current = word;
    }
    // A word longer than the window is cut where it runs out of room.
    while (current.length > width) {
      out.push(current.slice(0, width));
      current = current.slice(width);
    }
  }
  out.push(current);
  return out;
}

/** The rail every line of thinking is drawn behind, so it reads as an aside and not as the reply. */
const RAIL = '│ ';

/** The thinking as the lines it is drawn in: wrapped to fit behind the rail at `width`. */
export const wrapThinking = (reasoning: string, width: number): string[] =>
  reasoning.split('\n').flatMap((line) => wrapLine(line, Math.max(1, width - RAIL.length)));

/**
 * The live thinking window: the last lines of the thinking so far, each behind the rail,
 * padded to exactly the window's height. The window keeps its height and its width, so
 * the transcript above it does not jump as the model thinks.
 */
export function thinkingWindow(reasoning: string, size: ThinkingSize): string {
  const shown = wrapThinking(reasoning, size.width).slice(-size.lines).map((line) => RAIL + line);
  while (shown.length < size.lines) shown.push('');
  return shown.join('\n');
}

/** All of the thinking, behind the rail, for when its line is opened. */
export const thinkingText = (reasoning: string, width: number): string => wrapThinking(reasoning, width).map((line) => RAIL + line).join('\n');

/** Lines of thinking there are as drawn at `width`, not counting the blank ones. */
export const thinkingLines = (reasoning: string, width = THINKING_WIDTH): number => wrapThinking(reasoning, width).filter((line) => line.trim()).length;

/** The thinking's own line: over the window while it runs, and what it leaves behind once it is done, open or not. */
export function thinkingLine(reasoning: string, shown: boolean, marks = true, width = THINKING_WIDTH): string {
  const lines = thinkingLines(reasoning, width);
  return `${marks ? `${shown ? '▾' : '▸'} ` : ''}thinking, ${lines} line${lines === 1 ? '' : 's'}`;
}
