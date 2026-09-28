import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { readTranscript } from '../../src/core/transcript/read.js';
import type { TranscriptEvent } from '../../src/core/transcript/events.js';
import { readSessionIndex, historyDirFor } from '../../src/core/transcript/sessions.js';
import { createRedactor } from '../../src/core/redact.js';
import { hardFloor } from './floor.js';
import { callKey } from './features.js';
import { isAllow, isHuman, type Example, type LabelKind } from './types.js';

/** Answers a surface or a host gave when no one did, though the log says the person did. */
const NON_ANSWERS = [/^The editor did not answer\.?$/i, /^the person was asked and did not answer/i, /^the session was stopped$/i, /^a headless run cannot ask/i];
const STOPPED = /^the person stopped the turn$/i;

export interface ExtractResult {
  examples: Example[];
  skipped: { nested: number; unjoined: number; surface: number };
}

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}...` : text);

/** How the person answered, from the decision and what came with it. */
export function labelOf(decision: { allow: boolean; by: string; scope: string; feedback?: string }): LabelKind {
  if (decision.by !== 'user') return 'system';
  const feedback = decision.feedback?.trim();
  if (feedback && NON_ANSWERS.some((pattern) => pattern.test(feedback))) return 'system';
  if (decision.allow) return decision.scope === 'once' ? 'allow' : 'allow_grant';
  if (!feedback) return 'deny_call';
  return STOPPED.test(feedback) ? 'deny_stop' : 'deny_steer';
}

const parse = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : {};
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const redactValue = (value: unknown, redact: (text: string) => string): unknown => {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, redact));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, redact)]));
  return value;
};

/** Every approval in one session's log, joined to the call it decided. History is filled in later, across sessions. */
export function examplesFromEvents(events: TranscriptEvent[], options: { surfaces?: string[]; redact?: (text: string) => string } = {}): ExtractResult {
  const redact = options.redact ?? ((text: string) => text);
  const header = events.find((event): event is Extract<TranscriptEvent, { type: 'session' }> => event.type === 'session');
  const skipped = { nested: 0, unjoined: 0, surface: 0 };
  if (!header) return { examples: [], skipped };
  const child = Boolean(header.delegatedBy);
  if (options.surfaces && !options.surfaces.includes(child ? 'child' : header.surface)) {
    skipped.surface = events.filter((event) => event.type === 'approval').length;
    return { examples: [], skipped };
  }
  const calls = new Map<string, { name: string; args: Record<string, unknown>; ordinal: number }>();
  let mode: string = header.permissionMode ?? 'default';
  let request = '';
  let inTurn = 0;
  const examples: Example[] = [];
  for (const event of events) {
    if (event.type === 'permission_mode') mode = event.to;
    else if (event.type === 'message') {
      const message = event.message;
      if (message.role === 'user' && !message.content.startsWith('[') && !message.content.startsWith('Summary of the earlier conversation')) {
        request = clip(message.content, 500);
        inTurn = 0;
      } else if (message.role === 'assistant') {
        for (const call of message.tool_calls ?? []) {
          if (!call.id) continue;
          calls.set(call.id, { name: call.function.name, args: parse(call.function.arguments), ordinal: inTurn });
          inTurn += 1;
        }
      }
    } else if (event.type === 'approval') {
      // A nested id names a child's call under its parent's; the child's own log holds it whole.
      if (event.callId.includes('/')) {
        skipped.nested += 1;
        continue;
      }
      const call = calls.get(event.callId);
      if (!call) {
        skipped.unjoined += 1;
        continue;
      }
      const args = redactValue(call.args, redact) as Record<string, unknown>;
      const projectRoot = header.projectRoot;
      const label = labelOf({ allow: event.allow, by: event.by, scope: event.scope, feedback: event.feedback });
      const floor = hardFloor(call.name, call.args, projectRoot);
      examples.push({
        id: `${header.id}#${event.callId}`,
        session: header.id,
        projectRoot,
        project: path.basename(projectRoot) || projectRoot,
        ts: event.ts,
        surface: child ? 'child' : header.surface,
        child,
        mode,
        tool: call.name,
        args,
        ...(call.name === 'run_command' && typeof args.command === 'string' ? { command: args.command } : {}),
        request: redact(request),
        decidedBy: event.by,
        scope: event.scope,
        label,
        ...(event.feedback ? { feedback: redact(event.feedback) } : {}),
        turnCall: call.ordinal,
        history: { priorHuman: 0, priorAllows: 0, seenAllowed: false, seenDenied: false },
        ...(floor ? { floor } : {}),
      });
    }
  }
  return { examples, skipped };
}

/**
 * Fill each example's history from the human decisions before it in the same project, in
 * time order, so a feature never sees its own answer or anything later.
 */
export function withHistory(examples: Example[]): Example[] {
  const ordered = examples.map((example, index) => ({ example, index })).sort((a, b) => a.example.ts - b.example.ts || a.index - b.index);
  const state = new Map<string, { human: number; allows: number; allowed: Set<string>; denied: Set<string> }>();
  const out = new Map<number, Example>();
  for (const { example, index } of ordered) {
    const project = state.get(example.projectRoot) ?? { human: 0, allows: 0, allowed: new Set<string>(), denied: new Set<string>() };
    state.set(example.projectRoot, project);
    const key = callKey(example.tool, example.args);
    out.set(index, { ...example, history: { priorHuman: project.human, priorAllows: project.allows, seenAllowed: project.allowed.has(key), seenDenied: project.denied.has(key) } });
    if (!isHuman(example)) continue;
    project.human += 1;
    if (isAllow(example)) {
      project.allows += 1;
      project.allowed.add(key);
    } else project.denied.add(key);
  }
  return examples.map((_, index) => out.get(index)!);
}

/** The history folders of every project the session index knows, unless the caller names some. */
export function historyDirs(named?: string[]): string[] {
  if (named?.length) return named.map((dir) => path.resolve(dir));
  const roots = new Set(readSessionIndex().map((entry) => entry.projectRoot));
  return [...roots].map(historyDirFor).filter((dir) => fs.existsSync(dir));
}

/** A short hash of every example's id and label, so two runs can prove they saw the same decisions. */
export function fingerprint(examples: Example[]): string {
  const lines = examples.map((example) => `${example.id}\t${example.label}\t${example.floor ? 'floor' : ''}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

export interface Extraction extends ExtractResult {
  files: number;
}

/** Read every session under the given history folders into examples, redacted, with history. `until` (epoch ms) freezes a dataset at a date so a baseline can be rebuilt later. */
export function extract(dirs: string[], options: { surfaces?: string[]; env?: Record<string, string | undefined>; until?: number } = {}): Extraction {
  const redact = createRedactor(options.env ?? process.env);
  const all: Example[] = [];
  const skipped = { nested: 0, unjoined: 0, surface: 0 };
  let files = 0;
  for (const dir of dirs) {
    for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith('.jsonl')).sort()) {
      files += 1;
      const result = examplesFromEvents(readTranscript(path.join(dir, name)), { surfaces: options.surfaces, redact });
      all.push(...result.examples);
      skipped.nested += result.skipped.nested;
      skipped.unjoined += result.skipped.unjoined;
      skipped.surface += result.skipped.surface;
    }
  }
  // History only looks backwards, so cutting the end leaves every earlier example exactly as it was.
  const within = options.until === undefined ? all : all.filter((example) => example.ts <= options.until!);
  return { examples: withHistory(within), skipped, files };
}
