import fs from 'fs';
import { pathExists, readJson, writeJson } from '../../utils/fsx.js';
import path from 'path';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { ensureProjectStateDir } from '../transcript/log.js';

const JAMCLI_DIR = '.jamcli';
const TODO_FILE = 'todos.json';
const DEFAULT_SESSION = 'default';

const STATUSES = ['pending', 'in_progress', 'completed'] as const;
type TodoStatus = (typeof STATUSES)[number];

/**
 * A single checklist item. `active_form` is the present-tense label for it; `check` is
 * what proves it done: a test, a command, or what to look at.
 */
export interface TodoItem {
  content: string;
  status: TodoStatus;
  active_form?: string;
  check?: string;
  /** Set by the harness, never by the model: the gates that passed on the tree the item was completed on. */
  verified?: { gate: string; tree: string };
}

function resolveSession(session: unknown): string {
  return typeof session === 'string' && session.length ? session : DEFAULT_SESSION;
}

function resolveTodoFile(ctx: Pick<ToolContext, 'projectRoot'>, session: string): string {
  const name = session === DEFAULT_SESSION ? TODO_FILE : `todos-${session}.json`;
  return path.join(ctx.projectRoot, JAMCLI_DIR, name);
}

function normalizeItem(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const content = typeof record.content === 'string' ? record.content : '';
  if (!content.length) return null;
  const status = STATUSES.includes(record.status as TodoStatus) ? (record.status as TodoStatus) : 'pending';
  const item: TodoItem = { content, status };
  if (typeof record.active_form === 'string' && record.active_form.length) {
    item.active_form = record.active_form;
  }
  if (typeof record.check === 'string' && record.check.trim().length) {
    item.check = record.check.trim();
  }
  const verified = record.verified as Record<string, unknown> | undefined;
  if (verified && typeof verified.gate === 'string' && typeof verified.tree === 'string') {
    item.verified = { gate: verified.gate, tree: verified.tree };
  }
  return item;
}

/** The list as the model reads it: one numbered line per item, its check indented under it. */
export function formatTodos(todos: TodoItem[]): string {
  if (!todos.length) return 'No todos for this session.';
  return todos
    .map((todo, index) => {
      const marker = todo.status === 'completed' ? 'x' : todo.status === 'in_progress' ? '~' : ' ';
      const active = todo.active_form ? ` (active: ${todo.active_form})` : '';
      const check = todo.check ? `\n   check: ${todo.check}` : '';
      const verified = todo.verified ? ` [verified: ${todo.verified.gate}, tree ${todo.verified.tree.slice(0, 7)}]` : '';
      return `${index + 1}. [${marker}] ${todo.content}${active}${verified}${check}`;
    })
    .join('\n');
}

/**
 * Stamp every completed item that the gates have not yet vouched for on this tree. The
 * harness calls this once its gates pass; the model has no way to.
 */
export async function stampTodos(ctx: Pick<ToolContext, 'projectRoot'>, stamp: { gate: string; tree: string }, session: string = DEFAULT_SESSION): Promise<number> {
  const todos = await readTodos(ctx, session);
  let stamped = 0;
  for (const todo of todos) {
    if (todo.status !== 'completed' || todo.verified?.tree === stamp.tree) continue;
    todo.verified = { ...stamp };
    stamped += 1;
  }
  if (stamped) await writeTodos(ctx, session, todos);
  return stamped;
}

/** The session's todo list as saved, or an empty list when there is none or it cannot be read. */
export async function readTodos(ctx: Pick<ToolContext, 'projectRoot'>, session: string = DEFAULT_SESSION): Promise<TodoItem[]> {
  const file = resolveTodoFile(ctx, session);
  if (!(await pathExists(file))) return [];
  try {
    const data = await readJson(file);
    const list = Array.isArray(data) ? data : Array.isArray(data?.todos) ? data.todos : [];
    return (list as unknown[]).map(normalizeItem).filter((item): item is TodoItem => item !== null);
  } catch {
    return [];
  }
}

async function writeTodos(ctx: Pick<ToolContext, 'projectRoot'>, session: string, todos: TodoItem[]): Promise<string> {
  const file = resolveTodoFile(ctx, session);
  ensureProjectStateDir(ctx.projectRoot);
  await writeJson(file, { session, updated_at: new Date().toISOString(), todos }, { spaces: 2 });
  return file;
}

/**
 * Replace the session's todo list. The list is persisted under the project's
 * `.jamcli` directory so a long run has visible, durable state.
 */
export async function todoWriteRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const raw = args.todos;
  if (!Array.isArray(raw)) {
    throw new Error('todo_write requires a "todos" array.');
  }
  const session = resolveSession(args.session);
  const previous = await readTodos(ctx, session);
  const todos = raw.map((entry, index) => {
    const item = normalizeItem(entry);
    if (!item) {
      throw new Error(`todo item at index ${index} needs a non-empty "content".`);
    }
    // A stamp is the harness's, so the model's rewrite neither sets one nor loses one it earned.
    delete item.verified;
    const earned = previous.find((known) => known.content === item.content)?.verified;
    if (earned && item.status === 'completed') item.verified = earned;
    return item;
  });
  const file = await writeTodos(ctx, session, todos);

  return {
    output: formatTodos(todos),
    metadata: { session, count: todos.length, todos, path: path.relative(ctx.projectRoot, file) },
  };
}

/** Read the session's todo list back. */
export async function todoReadRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const session = resolveSession(args.session);
  const todos = await readTodos(ctx, session);
  return {
    output: formatTodos(todos),
    metadata: { session, count: todos.length, todos },
  };
}

const todoWriteSchema: JsonSchema = {
  type: 'object',
  properties: {
    todos: {
      type: 'array',
      description: 'The full todo list for the session. It replaces the previous list.',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'What the item is.' },
          status: {
            type: 'string',
            enum: [...STATUSES],
            description: 'Progress state of the item. Defaults to pending.',
          },
          active_form: { type: 'string', description: 'Present-tense label shown while the item is in progress.' },
          check: {
            type: 'string',
            description: 'What proves the item done: a test, a command and what it shows, or what to look at.',
          },
        },
        required: ['content'],
        additionalProperties: false,
      },
    },
    session: { type: 'string', description: 'Session to scope the list to. Defaults to "default".' },
  },
  required: ['todos'],
  additionalProperties: false,
};

const todoReadSchema: JsonSchema = {
  type: 'object',
  properties: {
    session: { type: 'string', description: 'Session to read. Defaults to "default".' },
  },
  required: [],
  additionalProperties: false,
};

const todoWriteWireSchema: JsonSchema = {
  type: 'object',
  properties: {
    todos: {
      type: 'array',
      description: 'The whole list; it replaces the previous one.',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          status: { type: 'string', enum: [...STATUSES], description: 'Defaults to pending.' },
          active_form: { type: 'string', description: 'Present-tense label while in progress.' },
          check: { type: 'string', description: 'What proves it done: a test, a command, or what to look at.' },
        },
        required: ['content'],
        additionalProperties: false,
      },
    },
  },
  required: ['todos'],
  additionalProperties: false,
};

export const TODO_TOOLS: RegisteredTool[] = [
  {
    name: 'todo_read',
    tier: 'core',
    description: 'Read the session todo list persisted under the project .jamcli directory.',
    inputSchema: todoReadSchema,
    wireSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    policy: 'read',
    runner: todoReadRunner,
  },
  {
    name: 'todo_write',
    tier: 'core',
    description: 'Replace the session todo list, kept in the project. One item in progress at a time; completed only after its check passed, which the harness stamps.',
    inputSchema: todoWriteSchema,
    wireSchema: todoWriteWireSchema,
    policy: 'state',
    runner: todoWriteRunner,
  },
];
