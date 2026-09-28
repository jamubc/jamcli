import type { ChatMessage } from '../types.js';
import { HeadTailBuffer } from '../tools/command.js';
import { estimateText } from './estimate.js';
import { isSummary } from './compact.js';

export type ElisionStage = 'E1' | 'E2' | 'E3' | 'E4' | 'E5';

export interface Elision {
  stage: ElisionStage;
  /** Index of the message in the conversation as it stood. */
  message: number;
  tokensRemoved: number;
  stub: string;
}

/** Steps a settled or failed command result is kept whole for. */
const COMMAND_AGE = 6;
/** Steps a large result is kept whole for. */
const LARGE_AGE = 10;
const LARGE_CHARS = 4_000;
const LARGE_HEAD = 1_000;
const LARGE_TAIL = 500;
const ERROR_LINE = /error|fail|Error:/i;

/** The share of the compaction budget at which elision runs once, before any summary is needed. */
export const ELIDE_AT = 0.6;

const WRITERS = new Set(['edit', 'write_file', 'apply_patch']);
const READERS = new Set(['read_file']);

const parseArgs = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
};

interface CallInfo {
  name: string;
  args: Record<string, unknown>;
  step: number;
}

/** Every tool call by id, with the step it was made in: the count of assistant messages before it. */
function callsOf(messages: ChatMessage[]): Map<string, CallInfo> {
  const calls = new Map<string, CallInfo>();
  let step = 0;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    step += 1;
    for (const call of message.tool_calls ?? []) {
      if (call.id) calls.set(call.id, { name: call.function.name, args: parseArgs(call.function.arguments), step });
    }
  }
  return calls;
}

const pathOf = (info: CallInfo | undefined): string | undefined => (typeof info?.args.path === 'string' ? info.args.path : undefined);

const exitOf = (content: string): number | undefined => {
  const match = /^Exit code (\d+)/.exec(content);
  return match ? Number(match[1]) : undefined;
};

const lastLines = (content: string, count: number) => content.split('\n').filter(Boolean).slice(-count).join('\n');

/**
 * Replace older tool results with short stubs that say what they were and why they are
 * gone. It runs before any summary, so a summary has less to read and less to lose. Only
 * messages before `keepFrom` are touched; the todo list's paths, anything the model
 * later quoted by path, the request, and summaries are never touched.
 */
export function elide(messages: ChatMessage[], keepFrom: number, options: { protectedPaths?: Iterable<string>; now?: number } = {}): { messages: ChatMessage[]; elisions: Elision[] } {
  const calls = callsOf(messages);
  const now = options.now ?? messages.filter((message) => message.role === 'assistant').length;
  const protectedPaths = new Set(options.protectedPaths ?? []);
  // A path the model named in a later reply is still in play. Its later calls are not the
  // test: the write that supersedes a read names the same path.
  const quotedText = messages.filter((message) => message.role === 'assistant').map((message) => message.content ?? '');
  // The step at which each path was last touched by a read or a write, for E1.
  const touched = new Map<string, { step: number; by: string }>();
  for (const info of calls.values()) {
    const target = pathOf(info);
    if (!target || (!READERS.has(info.name) && !WRITERS.has(info.name))) continue;
    const known = touched.get(target);
    if (known && known.step > info.step) continue;
    touched.set(target, { step: info.step, by: info.name });
  }
  const out = [...messages];
  const elisions: Elision[] = [];
  const seen = new Map<string, string>();
  const stepOfMessage: number[] = [];
  let step = 0;
  for (const message of messages) {
    if (message.role === 'assistant') step += 1;
    stepOfMessage.push(step);
  }
  const replace = (index: number, stage: ElisionStage, stub: string) => {
    const before = out[index].content ?? '';
    if (stub.length >= before.length) return;
    elisions.push({ stage, message: index, tokensRemoved: Math.max(0, estimateText(before) - estimateText(stub)), stub });
    out[index] = { ...out[index], content: stub };
  };

  for (let index = 0; index < Math.min(keepFrom, messages.length); index += 1) {
    const message = messages[index];
    if (message.role !== 'tool' || isSummary(message)) continue;
    const content = message.content ?? '';
    if (!content) continue;
    const call = message.tool_call_id ? calls.get(message.tool_call_id) : undefined;
    const name = message.toolName ?? call?.name ?? 'tool';
    const age = now - stepOfMessage[index];
    const target = pathOf(call);
    const inPlay = target !== undefined && (protectedPaths.has(target) || quotedText.slice(stepOfMessage[index]).some((text) => text.includes(target)));

    const duplicateOf = seen.get(content);
    if (duplicateOf !== undefined && !inPlay) {
      replace(index, 'E4', `[same as the result of call ${duplicateOf}]`);
      continue;
    }
    seen.set(content, message.tool_call_id ?? String(index));

    if (READERS.has(name) && target && !inPlay) {
      const later = touched.get(target);
      if (later && call && later.step > call.step) {
        const lines = /^\[Showing lines (\d+)-(\d+)/m.exec(content);
        replace(index, 'E1', `[read ${target}${lines ? ` lines ${lines[1]}-${lines[2]}` : ''}; superseded by ${later.by} at step ${later.step}]`);
        continue;
      }
    }
    if (name === 'run_command' && age > COMMAND_AGE) {
      const command = typeof call?.args.command === 'string' ? call.args.command : 'a command';
      const exit = exitOf(content);
      if (exit === 0) {
        replace(index, 'E2', `[ran \`${command}\`, exit 0; last lines:\n${lastLines(content, 3)}]`);
        continue;
      }
      if (exit !== undefined) {
        const firstError = content.split('\n').find((line) => ERROR_LINE.test(line) && !line.startsWith('Exit code'))?.trim();
        replace(index, 'E3', `[ran \`${command}\`, exit ${exit}${firstError ? `; ${firstError}` : ''}; last lines:\n${lastLines(content, 5)}]`);
        continue;
      }
    }
    if (content.length > LARGE_CHARS && age > LARGE_AGE && !inPlay) {
      const head = content.slice(0, LARGE_HEAD);
      const tail = content.slice(-LARGE_TAIL);
      const buffer = new HeadTailBuffer(LARGE_HEAD + LARGE_TAIL);
      buffer.push(head);
      buffer.push(content.slice(LARGE_HEAD, -LARGE_TAIL));
      buffer.push(tail);
      replace(index, 'E5', buffer.toString());
    }
  }
  return { messages: out, elisions };
}
