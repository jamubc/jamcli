import fs from 'fs-extra';
import path from 'path';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';

const JAMCLI_DIR = '.jamcli';
const TODO_FILE = 'todos.json';
const DEFAULT_SESSION = 'default';

const STATUSES = ['pending', 'in_progress', 'completed'] as const;
type TodoStatus = (typeof STATUSES)[number];

/** A single checklist item. `active_form` is the present-tense label for it. */
export interface TodoItem {
  content: string;
  status: TodoStatus;
  active_form?: string;
}

function resolveSession(session: unknown): string {
  return typeof session === 'string' && session.length ? session : DEFAULT_SESSION;
}

function resolveTodoFile(ctx: ToolContext, session: string): string {
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
  return item;
}

function formatTodos(todos: TodoItem[]): string {
  if (!todos.length) return 'No todos for this session.';
  return todos
    .map((todo, index) => {
      const marker = todo.status === 'completed' ? 'x' : todo.status === 'in_progress' ? '~' : ' ';
      const active = todo.active_form ? ` (active: ${todo.active_form})` : '';
      return `${index + 1}. [${marker}] ${todo.content}${active}`;
    })
    .join('\n');
}

async function readTodos(ctx: ToolContext, session: string): Promise<TodoItem[]> {
  const file = resolveTodoFile(ctx, session);
  if (!(await fs.pathExists(file))) return [];
  try {
    const data = await fs.readJson(file);
    const list = Array.isArray(data) ? data : Array.isArray(data?.todos) ? data.todos : [];
    return (list as unknown[]).map(normalizeItem).filter((item): item is TodoItem => item !== null);
  } catch {
    return [];
  }
}

async function writeTodos(ctx: ToolContext, session: string, todos: TodoItem[]): Promise<string> {
  const file = resolveTodoFile(ctx, session);
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, { session, updated_at: new Date().toISOString(), todos }, { spaces: 2 });
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
  const todos = raw.map((entry, index) => {
    const item = normalizeItem(entry);
    if (!item) {
      throw new Error(`todo item at index ${index} needs a non-empty "content".`);
    }
    return item;
  });
  const session = resolveSession(args.session);
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

export const TODO_TOOLS: RegisteredTool[] = [
  {
    name: 'todo_read',
    description: 'Read the session todo list persisted under the project .jamcli directory.',
    inputSchema: todoReadSchema,
    policy: 'read',
    runner: todoReadRunner,
  },
  {
    name: 'todo_write',
    description: 'Replace the session todo list, persisted under the project .jamcli directory.',
    inputSchema: todoWriteSchema,
    policy: 'state',
    runner: todoWriteRunner,
  },
];
