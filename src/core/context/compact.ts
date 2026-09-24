import type { ChatMessage, TokenUsage } from '../types.js';
import type { ChatProvider } from '../providers/types.js';
import { HeadTailBuffer } from '../tools/command.js';
import { ProviderError } from '../providers/http.js';
import { estimateMessage } from './estimate.js';

/** A provider refusing a request as longer than the model's window, in the words providers use. */
export function isContextOverflow(error: unknown): boolean {
  if (!(error instanceof ProviderError) || (error.status !== 400 && error.status !== 413)) return false;
  return /context (length|window)|too long|maximum.*tokens|token limit|too many tokens/i.test(error.detail ?? error.message);
}

export const SUMMARY_PREFIX = 'Summary of the earlier conversation:';
const REQUEST_HEADING = 'The request being worked on, verbatim:';

/** The message a compaction leaves in place of what it replaced. The session log rebuilds the same one. */
export const summaryMessage = (summary: string, timestamp: number): ChatMessage => ({
  role: 'user',
  content: `${SUMMARY_PREFIX}\n${summary}`,
  timestamp,
});

export const isSummary = (message: ChatMessage | undefined): boolean =>
  message?.role === 'user' && message.content.startsWith(`${SUMMARY_PREFIX}\n`);

/** The share of the budget the most recent messages may keep verbatim. */
export const KEEP_SHARE = 0.3;
/** Characters of each tool result and tool call the summarizer reads. */
const PART_CHARS = 2_000;
/** Most tokens a summary may take. */
const SUMMARY_OUTPUT_TOKENS = 8_192;

/**
 * Where to cut: the index of the first message kept verbatim. A cut never falls on a tool
 * result, so no tool call is parted from its results. It prefers the start of a user
 * turn, and inside a turn longer than the room to keep, it cuts at the start of an
 * assistant step. When everything fits, it keeps the latest turn whole. Undefined when
 * nothing before the cut is left to summarize: a single turn that fits, or a previous
 * summary alone.
 */
export function chooseBoundary(messages: ChatMessage[], keepTokens: number): number | undefined {
  const floor = isSummary(messages[0]) ? 1 : 0;
  let fits = messages.length;
  let kept = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    kept += estimateMessage(messages[index]);
    if (kept > keepTokens) break;
    fits = index;
  }
  if (fits <= floor + 1) {
    for (let index = messages.length - 1; index > floor; index -= 1) {
      if (messages[index].role === 'user') return index;
    }
    return undefined;
  }
  const from = fits;
  const cuttable = (index: number) => messages[index].role !== 'tool';
  let boundary: number | undefined;
  for (let index = from; index < messages.length && boundary === undefined; index += 1) {
    if (messages[index].role === 'user') boundary = index;
  }
  for (let index = from; index < messages.length && boundary === undefined; index += 1) {
    if (cuttable(index)) boundary = index;
  }
  // Not even the last step fits the room to keep: keep it whole anyway.
  for (let index = messages.length - 1; index > floor && boundary === undefined; index -= 1) {
    if (cuttable(index)) boundary = index;
  }
  return boundary !== undefined && boundary > floor ? boundary : undefined;
}

const bounded = (text: string): string => {
  if (text.length <= PART_CHARS) return text;
  const buffer = new HeadTailBuffer(PART_CHARS);
  buffer.push(text);
  return buffer.toString();
};

const argumentsText = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value ?? {}));

/** The conversation as the summarizer reads it, with long tool results and arguments cut in the middle. */
export function renderForSummary(messages: ChatMessage[]): string {
  const names = new Map<string, string>();
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      const name = message.toolName ?? names.get(message.tool_call_id ?? '') ?? 'tool';
      parts.push(`TOOL RESULT (${name}${message.toolStatus ? `, ${message.toolStatus}` : ''}):\n${bounded(message.content ?? '')}`);
      continue;
    }
    const text = message.content?.trim();
    if (text) parts.push(`${message.role.toUpperCase()}:\n${text}`);
    for (const call of message.tool_calls ?? []) {
      if (call.id) names.set(call.id, call.function.name);
      parts.push(`TOOL CALL ${call.function.name}: ${bounded(argumentsText(call.function.arguments))}`);
    }
  }
  return parts.join('\n\n');
}

export function summaryPrompt(messages: ChatMessage[], focus?: string): string {
  return [
    'Summarize the conversation below so the work can continue from the summary alone. It replaces the conversation, so keep everything the work still depends on:',
    '1. What the user asked for, with every constraint and preference they stated.',
    '2. Decisions made, and why.',
    '3. Files read, created, or changed, and what matters about each.',
    '4. Commands run and what they showed, errors included.',
    '5. What is done, what is in progress, and the next step.',
    'Be specific: names, paths, and values rather than descriptions of them. Write notes, not a letter.',
    ...(focus?.trim() ? [`Give particular attention to: ${focus.trim()}`] : []),
    '',
    '<conversation>',
    renderForSummary(messages),
    '</conversation>',
  ].join('\n');
}

/** The latest request the user made in these messages, carried over verbatim from an earlier summary when need be. */
function latestRequest(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    if (!isSummary(message)) return message.content;
    const carried = message.content.indexOf(`${REQUEST_HEADING}\n`);
    return carried >= 0 ? message.content.slice(carried + REQUEST_HEADING.length + 1) : undefined;
  }
  return undefined;
}

export interface CompactInput {
  messages: ChatMessage[];
  provider: ChatProvider;
  model?: string;
  /** Tokens the most recent messages may keep verbatim. */
  keepTokens: number;
  /** What the summary should give particular attention to. */
  focus?: string;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  contextLength?: number;
}

export interface CompactResult {
  /** The conversation after compaction: the summary, then the messages kept verbatim. */
  messages: ChatMessage[];
  /** How many messages the summary replaced, counted from the start. */
  replaced: number;
  /** The summary's text, without the heading the summary message adds. */
  summary: string;
  /** `summary` when the model summarized; `drop` when it could not and the messages were left out. */
  strategy: 'summary' | 'drop';
  /** What the summary request used, when the provider reported it. */
  usage?: TokenUsage;
  /** Why the summary failed, when it did. */
  error?: string;
}

/**
 * Replace the older part of a conversation with a summary, keeping the most recent
 * messages verbatim. A summary that fails leaves the older messages out instead, and
 * says so in their place. A cut inside the current turn keeps its request verbatim.
 */
export async function compact(input: CompactInput): Promise<CompactResult | undefined> {
  input.signal?.throwIfAborted();
  const boundary = chooseBoundary(input.messages, input.keepTokens);
  if (boundary === undefined) return undefined;
  const earlier = input.messages.slice(0, boundary);
  const kept = input.messages.slice(boundary);
  const request = kept.some((message) => message.role === 'user' && !isSummary(message)) ? undefined : latestRequest(earlier);

  let summary: string;
  let strategy: CompactResult['strategy'] = 'summary';
  let usage: TokenUsage | undefined;
  let error: string | undefined;
  try {
    const result = await input.provider.complete([{ role: 'user', content: summaryPrompt(earlier, input.focus), timestamp: Date.now() }], {
      model: input.model,
      signal: input.signal,
      maxOutputTokens: Math.min(SUMMARY_OUTPUT_TOKENS, input.maxOutputTokens ?? SUMMARY_OUTPUT_TOKENS),
      contextLength: input.contextLength,
    });
    usage = result.usage;
    input.signal?.throwIfAborted();
    summary = (result.content ?? '').trim();
    if (!summary) throw new Error('the summary came back empty');
  } catch (caught: any) {
    if (input.signal?.aborted) throw caught;
    error = caught?.message ?? String(caught);
    summary = `(The earlier conversation could not be summarized, so it was left out: ${error})`;
    strategy = 'drop';
  }
  if (request) summary += `\n\n${REQUEST_HEADING}\n${request}`;
  return {
    messages: [summaryMessage(summary, Date.now()), ...kept],
    replaced: boundary,
    summary,
    strategy,
    ...(usage ? { usage } : {}),
    ...(error ? { error } : {}),
  };
}
