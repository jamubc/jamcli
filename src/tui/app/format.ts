import { formatTokens, formatUsd } from '../../core/catalog/cost.js';
import type { Phase, Row, StatusData, ToolPhase } from '../state/view.js';
import { STATUS_WORD_PHASES, type StatusWordPhase, type StatusWords } from '../../types/config.js';

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

/**
 * The word a style shows for a phase in place of its own: the `seed`th of the style's words
 * for it, or nothing when it has none, as for retrying and compacting, which keep theirs.
 */
export function phaseWord(words: StatusWords | undefined, phase: Phase, seed: number): string | undefined {
  const pool = (STATUS_WORD_PHASES as readonly Phase[]).includes(phase) ? words?.[phase as StatusWordPhase] : undefined;
  return pool?.length ? pool[seed % pool.length] : undefined;
}

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
  // A grant names the rule the person chose, so what "this session" now covers is read where it was given.
  const decided = row.decision?.by === 'user' ? `${row.decision.allow ? 'allowed' : 'denied'} by you${row.decision.allow && row.decision.rule ? `${marks ? ' · ' : ' with '}${row.decision.rule}` : ''}` : undefined;
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
  // What runs beside the turn is kept longest, since it is what the person may need to stop.
  const work = [status.work?.jobs ? `${status.work.jobs} job${status.work.jobs === 1 ? '' : 's'}` : '', status.work?.agents ? `${status.work.agents} agent${status.work.agents === 1 ? '' : 's'}` : ''].filter(Boolean);
  if (work.length) parts.push({ text: work.join(', '), drop: 8 });
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

/**
 * Text broken at spaces into lines no wider than `width`, and at most `lines` of them; when
 * there is more, the last line ends in an ellipsis. Its own line breaks are kept.
 */
export function wrapWithin(text: string, width: number, lines: number): string[] {
  const room = Math.max(1, width);
  const all = text.split('\n').flatMap((line) => wrapLine(line, room));
  if (all.length <= lines) return all;
  const kept = all.slice(0, lines);
  const last = kept[lines - 1];
  kept[lines - 1] = `${last.length >= room ? last.slice(0, room - 1) : last}…`;
  return kept;
}

/** The rail and its gutter, which the thinking is drawn behind. */
const RAIL_WIDTH = 2;

/** The thinking as the lines it is drawn in behind the rail at `width`. */
export const wrapThinking = (reasoning: string, width: number): string[] =>
  reasoning.split('\n').flatMap((line) => wrapLine(line, Math.max(1, width - RAIL_WIDTH)));

/** Lines of thinking there are as drawn at `width`, not counting the blank ones. */
export const thinkingLines = (reasoning: string, width = THINKING_WIDTH): number => wrapThinking(reasoning, width).filter((line) => line.trim()).length;

/** The thinking's own line: over the window while it runs, and what it leaves behind once it is done, open or not. */
export function thinkingLine(reasoning: string, shown: boolean, marks = true, width = THINKING_WIDTH): string {
  const lines = thinkingLines(reasoning, width);
  return `${marks ? `${shown ? '▾' : '▸'} ` : ''}thinking, ${lines} line${lines === 1 ? '' : 's'}`;
}

/** The inline markers a reply may leave open mid-stream, longest first so `**` is seen before `*`. */
const INLINE_MARKERS = ['**', '__', '~~', '*', '_'] as const;

/** Whether the text ends inside a fenced code block: an odd number of fence lines so far. */
function inFence(text: string): boolean {
  let fences = 0;
  for (const line of text.split('\n')) if (/^ {0,3}(```|~~~)/.test(line)) fences += 1;
  return fences % 2 === 1;
}

/**
 * A reply still arriving, with the inline markers it has opened and not yet closed
 * closed for it. The markdown view conceals a marker only once its pair has arrived, so
 * without this `**bo` shows its asterisks and then loses them when `ld**` lands, and every
 * word after it jumps left. Closed early, the words are styled from their first character
 * and stay put; when the real closer arrives the text is the same. A marker with nothing
 * after it yet is left out rather than closed, since `****` is not bold. Only the last
 * block can be unfinished, so only it is read, and text inside a fenced code block is left
 * as it is.
 */
export function closeMarkers(text: string): string {
  if (inFence(text)) return text;
  const start = Math.max(0, text.lastIndexOf('\n\n'));
  const tail = text.slice(start);
  const open: { marker: string; at: number }[] = [];
  let code: { run: string; at: number } | undefined;
  let i = 0;
  while (i < tail.length) {
    if (code) {
      const closes = tail.startsWith(code.run, i) && tail[i + code.run.length] !== '`';
      i += closes ? code.run.length : 1;
      if (closes) code = undefined;
      continue;
    }
    const char = tail[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '`') {
      let run = 0;
      while (tail[i + run] === '`') run += 1;
      code = { run: '`'.repeat(run), at: i };
      i += run;
      continue;
    }
    const marker = INLINE_MARKERS.find((candidate) => tail.startsWith(candidate, i));
    if (!marker) {
      i += 1;
      continue;
    }
    if (open.at(-1)?.marker === marker) open.pop();
    else {
      const next = tail[i + marker.length];
      const prev = tail[i - 1];
      // An opener has a word right after it; `_` also has none right before, so snake_case stays words.
      const flanking = next !== undefined && !/\s/.test(next) && (marker[0] !== '_' || prev === undefined || !/\w/.test(prev));
      // A lone `*` at the very end is more often arithmetic than emphasis, so it stays as written.
      const bare = next === undefined && marker.length > 1;
      if (flanking || bare) open.push({ marker, at: i });
    }
    i += marker.length;
  }
  // The last opener, with nothing after it yet, is dropped; everything else open is closed.
  let cut = tail.length;
  const closers: string[] = [];
  if (code) {
    if (code.at + code.run.length === tail.length) cut = code.at;
    else closers.push(code.run);
  } else if (open.length && open.at(-1)!.at + open.at(-1)!.marker.length === tail.length) {
    cut = open.pop()!.at;
  }
  while (open.length) closers.push(open.pop()!.marker);
  let out = text.slice(0, start + cut);
  if (!closers.length) return out;
  // An emphasis closer has to follow a word, so the tail's trailing whitespace goes first.
  if (closers[0] !== code?.run) out = out.trimEnd();
  return out + closers.join('');
}

/** A run of bracketed numbers, `[1]`, `[6][7]`, `[3, 4]`, `[5-7]`, that is not the text of a link. */
const NUMBERED_BRACKETS = /(?:\[\d+(?:\s*[,–-]\s*\d+)*\])+(?!\()/g;

/**
 * A reply with its bracketed numbers set as inline code. The markdown view, which conceals
 * markup, takes `[1]` for a reference link and hides the brackets, and `[6][7]` for a
 * reference with a label and drops the 7, so a report's citations came out as stray
 * digits. As inline code they show as written. Fenced blocks and code spans are left
 * as they are, and so is a real link, `[text](address)`, which the view draws as one.
 */
export function keepCitations(text: string): string {
  let fenced = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^ {0,3}(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, index) => (index % 2 ? part : part.replace(NUMBERED_BRACKETS, '`$&`')))
        .join('');
    })
    .join('\n');
}

/**
 * A sent message cut into plain text and the words the interface highlights: a command it
 * starts with, and each session it names, by id or by a name in `names` (compared without
 * case). Joined back, the parts are the message.
 */
export function mentionParts(text: string, names: ReadonlySet<string>): { text: string; hot: boolean }[] {
  const parts: { text: string; hot: boolean }[] = [];
  const command = /^\/[\w:.-]+/.exec(text)?.[0];
  let rest = text;
  if (command) {
    parts.push({ text: command, hot: true });
    rest = text.slice(command.length);
  }
  const word = /\d{4}-\d{2}-\d{2}-[0-9a-f]{8}|[A-Za-z0-9._-]+/g;
  let last = 0;
  for (const match of rest.matchAll(word)) {
    const token = match[0].replace(/\.+$/, '');
    const hot = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/.test(token) || names.has(token.toLowerCase());
    if (!hot) continue;
    if (match.index! > last) parts.push({ text: rest.slice(last, match.index), hot: false });
    parts.push({ text: token, hot: true });
    last = match.index! + token.length;
  }
  if (last < rest.length) parts.push({ text: rest.slice(last), hot: false });
  // Neighbouring plain parts are one.
  return parts.reduce<{ text: string; hot: boolean }[]>((joined, part) => {
    const previous = joined.at(-1);
    if (previous && !previous.hot && !part.hot) previous.text += part.text;
    else joined.push({ ...part });
    return joined;
  }, []);
}
