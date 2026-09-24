import { test, expect, beforeAll, afterAll } from 'bun:test';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { remove } from '../../../utils/fsx.js';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';

const run = promisify(execFile);

let projectRoot: string;

beforeAll(async () => {
  projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-git-'));
  await run('git', ['init', '-q'], { cwd: projectRoot });
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot });
  await run('git', ['config', 'user.name', 'Test User'], { cwd: projectRoot });
});

afterAll(async () => {
  await remove(projectRoot);
});

test('git_status reports an untracked file in a temporary repository', async () => {
  await fs.promises.writeFile(path.join(projectRoot, 'notes.txt'), 'hello\n');
  const registry = createBuiltinRegistry();

  const result = await registry.execute('git_status', {}, { projectRoot });

  expect(result.success).toBe(true);
  expect(result.output).toContain('??');
  expect(result.output).toContain('notes.txt');
});

test('git_diff shows an unstaged change to a tracked file', async () => {
  const tracked = path.join(projectRoot, 'tracked.txt');
  await fs.promises.writeFile(tracked, 'original\n');
  await run('git', ['add', 'tracked.txt'], { cwd: projectRoot });
  await run('git', ['commit', '-qm', 'add tracked'], { cwd: projectRoot });
  await fs.promises.writeFile(tracked, 'updated\n');

  const registry = createBuiltinRegistry();
  const result = await registry.execute('git_diff', {}, { projectRoot });

  expect(result.success).toBe(true);
  expect(result.output).toContain('tracked.txt');
  expect(result.output).toContain('+updated');
});
