import fs from 'fs';
import path from 'path';
import { applyPatch, parsePatch, reversePatch } from 'diff';
import type { SessionUpdate, ToolCallContent, ToolCallLocation, ToolKind, PlanEntry, StopReason } from '@agentclientprotocol/sdk';
import type { AgentEvent, ChatMessage, RunStatus, ToolCall, ToolResult } from '../core/types.js';

/** Characters of one tool result sent to the client. The model's copy is cut separately. */
const OUTPUT_LIMIT = 20_000;

const KINDS: Record<string, ToolKind> = {
  read_file: 'read',
  glob: 'search',
  grep: 'search',
  search_tools: 'search',
  edit: 'edit',
  write_file: 'edit',
  apply_patch: 'edit',
  run_command: 'execute',
  git_commit: 'execute',
  todo_write: 'think',
  todo_read: 'think',
  skill: 'read',
  task: 'think',
  web_fetch: 'fetch',
};

/** What a tool does, in ACP's words, so a client can pick an icon. */
export const toolKind = (name: string): ToolKind => KINDS[name] ?? 'other';

const pathsOf = (call: ToolCall): string[] => {
  const args = call.arguments ?? {};
  const found = [args.path, args.file_path, args.file, ...(Array.isArray(args.paths) ? args.paths : [])].filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (call.name === 'apply_patch' && typeof args.patch === 'string') {
    for (const match of args.patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) found.push(match[1].trim());
    try {
      for (const entry of parsePatch(args.patch)) {
        for (const name of [entry.oldFileName, entry.newFileName]) {
          const trimmed = name?.split('\t')[0].trim().replace(/^[ab]\//, '');
          if (trimmed && trimmed !== '/dev/null') found.push(trimmed);
        }
      }
    } catch {
      // A patch that does not parse will fail when it is applied too.
    }
  }
  return [...new Set(found)];
};

/** The files a call touches, as absolute paths. */
export const toolLocations = (call: ToolCall, root: string): ToolCallLocation[] =>
  pathsOf(call).map((file) => ({ path: path.resolve(root, file) }));

/** A short title a client can show as is: "edit src/a.ts", "run_command: bun test". */
export function toolTitle(call: ToolCall): string {
  const args = call.arguments ?? {};
  if (call.name === 'run_command' && typeof args.command === 'string') return `run_command: ${args.command.split('\n')[0].slice(0, 120)}`;
  if (call.name === 'web_fetch' && typeof args.url === 'string') return `web_fetch ${args.url}`;
  const files = pathsOf(call);
  if (files.length) return `${call.name} ${files.join(', ')}`;
  if (typeof args.pattern === 'string') return `${call.name} ${args.pattern}`;
  if (typeof args.query === 'string') return `${call.name} ${args.query}`;
  return call.name;
}

/** The ACP stop reason for how a turn ended. */
export const stopReasonFor = (status: RunStatus): StopReason => {
  switch (status) {
    case 'ok':
      return 'end_turn';
    case 'limit':
      return 'max_turn_requests';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'refusal';
  }
};

const text = (value: string) => ({ type: 'text' as const, text: value });

/** A change's before and after, from the unified diff an edit reports and the file as it is now. */
function diffContent(result: ToolResult, root: string): ToolCallContent | undefined {
  const patch = result.metadata?.diff;
  const target = result.metadata?.path;
  if (typeof patch !== 'string' || typeof target !== 'string') return undefined;
  const absolute = path.resolve(root, target);
  try {
    const now = fs.readFileSync(absolute, 'utf8');
    const before = applyPatch(now, reversePatch(parsePatch(patch)[0]));
    return { type: 'diff', path: absolute, oldText: before === false ? null : before, newText: now };
  } catch {
    return undefined;
  }
}

/** The agent's todo list as an ACP plan. */
const planOf = (call: ToolCall): PlanEntry[] | undefined => {
  const todos = call.arguments?.todos;
  if (call.name !== 'todo_write' || !Array.isArray(todos)) return undefined;
  return todos.map((todo: any) => ({
    content: String(todo?.content ?? ''),
    priority: 'medium' as const,
    status: todo?.status === 'in_progress' || todo?.status === 'completed' ? todo.status : 'pending',
  }));
};

/**
 * Turns the runtime's events into ACP session updates. One per session: it remembers the
 * calls it has announced, so a result names its call's files.
 */
export class UpdateMapper {
  private readonly calls = new Map<string, ToolCall>();

  constructor(readonly root: string) {}

  map(event: AgentEvent): SessionUpdate[] {
    switch (event.type) {
      case 'text':
        return [{ sessionUpdate: 'agent_message_chunk', content: text(event.delta) }];
      case 'reasoning':
        return [{ sessionUpdate: 'agent_thought_chunk', content: text(event.delta) }];
      case 'tool_call': {
        this.calls.set(event.call.id, event.call);
        const plan = planOf(event.call);
        return [
          {
            sessionUpdate: 'tool_call',
            toolCallId: event.call.id,
            title: toolTitle(event.call),
            kind: toolKind(event.call.name),
            status: 'in_progress',
            rawInput: event.call.arguments ?? {},
            locations: toolLocations(event.call, this.root),
          },
          ...(plan ? [{ sessionUpdate: 'plan' as const, entries: plan }] : []),
        ];
      }
      case 'approval_request':
        // ACP's stable word for a call waiting on the person.
        return [{ sessionUpdate: 'tool_call_update', toolCallId: event.call.id, status: 'pending' }];
      case 'tool_result': {
        const id = event.result.callId ?? event.result.tool;
        const failed = !event.result.success || (event.result.status !== undefined && event.result.status !== 'ok');
        const diff = failed ? undefined : diffContent(event.result, this.root);
        const output = event.result.output ?? '';
        const content: ToolCallContent[] = diff
          ? [diff]
          : output
            ? [{ type: 'content', content: text(output.length > OUTPUT_LIMIT ? `${output.slice(0, OUTPUT_LIMIT)}\n[${output.length - OUTPUT_LIMIT} more characters]` : output) }]
            : [];
        this.calls.delete(id);
        return [{ sessionUpdate: 'tool_call_update', toolCallId: id, status: failed ? 'failed' : 'completed', content }];
      }
      case 'notice':
        return [{ sessionUpdate: 'agent_message_chunk', content: text(`${event.message}\n`) }];
      default:
        return [];
    }
  }

  /** A recorded conversation as the updates that would have streamed, for `session/load`. */
  replay(messages: ChatMessage[]): SessionUpdate[] {
    const updates: SessionUpdate[] = [];
    for (const message of messages) {
      if (message.role === 'user' && message.content) updates.push({ sessionUpdate: 'user_message_chunk', content: text(message.content) });
      if (message.role === 'assistant') {
        if (message.content) updates.push({ sessionUpdate: 'agent_message_chunk', content: text(message.content) });
        for (const call of message.tool_calls ?? []) {
          const parsed: ToolCall = { id: call.id ?? '', name: call.function.name, arguments: safeJson(call.function.arguments) };
          updates.push({
            sessionUpdate: 'tool_call',
            toolCallId: parsed.id,
            title: toolTitle(parsed),
            kind: toolKind(parsed.name),
            status: 'completed',
            rawInput: parsed.arguments,
            locations: toolLocations(parsed, this.root),
          });
        }
      }
    }
    return updates;
  }
}

const safeJson = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object') return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};
