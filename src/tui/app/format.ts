import { formatUsd } from '../../core/catalog/cost.js';
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

export const formatTokens = (count: number): string =>
  count < 1000 ? String(count) : count < 1_000_000 ? `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k` : `${(count / 1_000_000).toFixed(1)}M`;

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
  const parts = [`${status.mode} mode`, status.model || 'no model'];
  if (status.contextPercent !== undefined) parts.push(`context ${Math.round(status.contextPercent)}%`);
  if (status.costUsd !== null) parts.push(`${formatUsd(status.costUsd)}${status.unpriced ? '+' : ''}`);
  else if (status.inputTokens || status.outputTokens) parts.push('cost unknown');
  if (status.inputTokens || status.outputTokens) parts.push(`${formatTokens(status.inputTokens)} in, ${formatTokens(status.outputTokens)} out`);
  parts.push(status.sandbox === 'none' ? 'no sandbox' : `sandbox ${status.sandbox}`);
  if (status.mcpServers) parts.push(`MCP ${status.mcpServers}`);
  const phase = status.phase === 'retrying' && status.retry ? `retrying (${status.retry.attempt}): ${status.retry.reason}` : PHASE_WORDS[status.phase];
  parts.push(phase);
  return parts;
}
