import { describeCall } from '../approval.js';
import { filesOfCall } from '../git/checkpoints.js';
import type { TranscriptEvent } from '../transcript/events.js';
import type { ToolCall } from '../types.js';

/** One decision a session's log records: a call that changed something or was refused, and why. */
export interface LedgerEntry {
  session: string;
  surface: string;
  ts: number;
  tool: string;
  /** What the call reached, as its approval prompt names it: a path, a command, a domain. */
  target: string;
  allowed: boolean;
  /** Who decided: a flag, the person, configuration, the mode, or a hook. */
  by: string;
  /** The rule that decided, as written, or the pattern the person granted. */
  rule?: string;
  /** Where that rule came from, in logs written since it was recorded. */
  source?: string;
  reason?: string;
  /** What the person said with an answer. */
  feedback?: string;
  /** The files the call changed: those it names, or for a command, those its step's checkpoint shows. */
  changed?: string[];
}

export interface LedgerOptions {
  /** The files between a checkpoint and the tree its step left, when git can say. */
  changedBetween?: (ref: string, after: string) => string[];
}

const argumentsOf = (raw: unknown): Record<string, unknown> => {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/**
 * The decisions one session's log records, in order. Reads and the session's own plan are
 * not logged as decisions, so they are not here; every call that changed something, every
 * refusal, and every answer a person gave is.
 */
export function ledgerOf(events: TranscriptEvent[], options: LedgerOptions = {}): LedgerEntry[] {
  const header = events.find((event) => event.type === 'session') as Extract<TranscriptEvent, { type: 'session' }> | undefined;
  const calls = new Map<string, ToolCall>();
  const entries: LedgerEntry[] = [];
  /** A command's entry waits for the checkpoint its step records. */
  const commands: { entry: LedgerEntry; label: string }[] = [];
  for (const event of events) {
    if (event.type === 'message') {
      for (const call of event.message.tool_calls ?? []) {
        if (call.id) calls.set(call.id, { id: call.id, name: call.function.name, arguments: argumentsOf(call.function.arguments) });
      }
    } else if (event.type === 'approval') {
      const call = calls.get(event.callId) ?? { id: event.callId, name: event.tool, arguments: {} };
      const entry: LedgerEntry = {
        session: header?.id ?? '',
        surface: event.surface,
        ts: event.ts,
        tool: event.tool,
        target: describeCall(call),
        allowed: event.allow,
        by: event.by,
        ...(event.rule ? { rule: event.rule } : {}),
        ...(event.source ? { source: event.source } : {}),
        ...(event.reason ? { reason: event.reason } : {}),
        ...(event.feedback ? { feedback: event.feedback } : {}),
      };
      if (event.allow) {
        const named = filesOfCall(call, header?.projectRoot ?? '.');
        if (named.length) entry.changed = named;
        else if (call.name === 'run_command') commands.push({ entry, label: describeCall(call) });
      }
      entries.push(entry);
    } else if (event.type === 'checkpoint' && event.after && options.changedBetween) {
      const waiting = commands.findIndex((command) => command.label === event.label);
      if (waiting >= 0) {
        const changed = options.changedBetween(event.ref, event.after);
        if (changed.length) commands[waiting]!.entry.changed = changed;
        commands.splice(waiting, 1);
      }
    }
  }
  return entries;
}

/** One line per decision, under a heading per session. */
export function renderLedger(entries: LedgerEntry[]): string {
  if (!entries.length) return 'No decisions recorded.';
  const lines: string[] = [];
  let session = '';
  for (const entry of entries) {
    if (entry.session !== session) {
      session = entry.session;
      lines.push('', `${new Date(entry.ts).toISOString().slice(0, 16).replace('T', ' ')}  ${entry.session}  ${entry.surface}`);
    }
    const why = entry.rule ? `rule ${entry.rule}${entry.source ? ` from ${entry.source}` : ''}` : entry.reason ?? '';
    const said = entry.feedback ? ` ("${entry.feedback}")` : '';
    const changed = entry.changed?.length ? `; changed ${entry.changed.join(', ')}` : '';
    lines.push(`  ${entry.allowed ? 'allowed' : 'refused'}  ${entry.target}  by ${entry.by}: ${why}${said}${changed}`);
  }
  return lines.join('\n').trimStart();
}
