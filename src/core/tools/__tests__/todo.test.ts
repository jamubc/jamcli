import { test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'fs';
import { pathExists, remove } from '../../../utils/fsx.js';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';

let projectRoot: string;

beforeAll(async () => {
  projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-todo-'));
});

afterAll(async () => {
  await remove(projectRoot);
});

test('todo_write persists a list that todo_read returns', async () => {
  const registry = createBuiltinRegistry();
  const todos = [
    { content: 'Wire the glob tool', status: 'completed', active_form: 'Wiring the glob tool' },
    { content: 'Wire the grep tool', status: 'in_progress', active_form: 'Wiring the grep tool' },
  ];

  const write = await registry.execute('todo_write', { todos }, { projectRoot });
  expect(write.success).toBe(true);

  const file = path.join(projectRoot, '.jamcli', 'todos.json');
  expect(await pathExists(file)).toBe(true);
  // The list is local state, so the directory holding it ignores itself (F18).
  expect(await fs.promises.readFile(path.join(projectRoot, '.jamcli', '.gitignore'), 'utf8')).toContain('\n*\n');

  const read = await registry.execute('todo_read', {}, { projectRoot });
  expect(read.success).toBe(true);
  expect(read.metadata?.todos).toEqual(todos);
});

test('todo lists are scoped per session', async () => {
  const registry = createBuiltinRegistry();
  await registry.execute('todo_write', { session: 'alpha', todos: [{ content: 'alpha task', status: 'pending' }] }, { projectRoot });
  await registry.execute('todo_write', { session: 'beta', todos: [{ content: 'beta task', status: 'pending' }] }, { projectRoot });

  const alpha = await registry.execute('todo_read', { session: 'alpha' }, { projectRoot });
  const beta = await registry.execute('todo_read', { session: 'beta' }, { projectRoot });

  expect((alpha.metadata?.todos as { content: string }[])[0].content).toBe('alpha task');
  expect((beta.metadata?.todos as { content: string }[])[0].content).toBe('beta task');
});
