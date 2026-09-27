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

export const PHASE_WORDS: Record<Phase, string> = {
  idle: 'ready',
  thinking: 'thinking',
  streaming: 'writing',
  tool: 'running tools',
  waiting: 'waiting for you',
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

/** The one line a tool block shows when collapsed. */
export function toolLine(row: Extract<Row, { kind: 'tool' }>, marks = true): string {
  const phase = TOOL_PHASES[row.phase];
  const duration = formatDuration(row.durationMs);
  const stat = row.diff ? diffStat(row.diff) : undefined;
  const lines = stat ? `, ${stat.added} line${stat.added === 1 ? '' : 's'} added and ${stat.removed} removed` : '';
  const decided = row.decision?.by === 'user' ? ` (${row.decision.allow ? 'allowed' : 'denied'} by you)` : '';
  return `${marks ? `${phase.mark} ` : ''}${phase.word}: ${row.summary}${lines}${duration ? `, ${duration}` : ''}${decided}`;
}

export function noticeLine(row: Extract<Row, { kind: 'notice' }>, marks = true): string {
  return `${marks ? `${NOTICE_MARKS[row.level]} ` : ''}${row.level === 'info' ? '' : `${row.level === 'warn' ? 'warning' : 'error'}: `}${row.text}`;
}

export function compactionLine(row: Extract<Row, { kind: 'compaction' }>): string {
  const how = row.strategy === 'summary' ? 'summarized' : 'left out, because the summary failed';
  return `The earlier conversation was ${how}${row.trigger === 'auto' ? ' to fit the context window' : ''}: ${row.beforeTokens.toLocaleString('en-US')} to ${row.afterTokens.toLocaleString('en-US')} tokens.`;
}

/** The status line's parts, left to right. */
export function statusParts(status: StatusData): string[] {
  const parts = [status.mode === 'bypass' ? 'BYPASS mode' : `${status.mode} mode`, status.model || 'no model'];
  if (status.contextPercent !== undefined) parts.push(`context ${Math.round(status.contextPercent)}%`);
  // Nothing is billed for a free model, so a cost of nothing takes no room; /cost still says it.
  if (status.costUsd !== null && (status.costUsd > 0 || status.unpriced)) parts.push(`${formatUsd(status.costUsd)}${status.unpriced ? '+' : ''}`);
  else if (status.inputTokens || status.outputTokens) parts.push('cost unknown');
  if (status.inputTokens || status.outputTokens) parts.push(`${formatTokens(status.inputTokens)} in, ${formatTokens(status.outputTokens)} out`);
  parts.push(status.sandbox === 'none' ? 'no sandbox' : `sandbox ${status.sandbox}`);
  if (status.mcpServers) parts.push(`MCP ${status.mcpServers}`);
  if (status.lspServers) parts.push(`LSP ${status.lspServers}`);
  if (status.expanded) parts.push('expanded view');
  const phase = status.phase === 'retrying' && status.retry ? `retrying (${status.retry.attempt}): ${status.retry.reason}` : PHASE_WORDS[status.phase];
  parts.push(phase);
  return parts;
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

/**
 * The live thinking window: the last lines of the thinking so far, wrapped to the
 * window's width and padded to exactly its height. The window keeps both, so the
 * transcript above it does not jump as the model thinks.
 */
export function thinkingWindow(reasoning: string, size: ThinkingSize): string {
  const wrapped = reasoning.split('\n').flatMap((line) => wrapLine(line, size.width));
  const shown = wrapped.slice(-size.lines);
  while (shown.length < size.lines) shown.push('');
  return shown.join('\n');
}

/** Lines of thinking there are, not counting the blank ones. */
export const thinkingLines = (reasoning: string): number => reasoning.split('\n').filter((line) => line.trim()).length;

/** The one line the thinking leaves behind once it is done, open or not. */
export function thinkingLine(reasoning: string, shown: boolean, marks = true): string {
  const lines = thinkingLines(reasoning);
  return `${marks ? `${shown ? '▾' : '▸'} ` : ''}thinking, ${lines} line${lines === 1 ? '' : 's'}`;
}
