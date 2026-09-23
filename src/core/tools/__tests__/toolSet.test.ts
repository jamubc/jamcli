import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jamcli-toolset-'));
});

afterEach(async () => {
  await fs.remove(projectRoot);
});

const exec = (tool: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  createBuiltinRegistry().execute(tool, args, { projectRoot, ignorePatterns: [], ...extra });

test('one tool per job is advertised, and the old names stay callable as hidden aliases', async () => {
  const registry = createBuiltinRegistry();
  const visible = registry.visible().map((tool) => tool.name);
  expect(visible).toContain('glob');
  expect(visible).toContain('grep');
  expect(visible).not.toContain('list_files');
  expect(visible).not.toContain('search_code');
  expect(registry.get('list_files')?.aliasOf).toBe('glob');
  expect(registry.get('search_code')?.aliasOf).toBe('grep');

  await fs.writeFile(path.join(projectRoot, 'notes.md'), 'Find Me here\n');
  const listed = await exec('list_files', { pattern: '*.md' });
  expect(listed.output).toContain('notes.md');
  const searched = await exec('search_code', { query: 'find me' });
  expect(searched.output).toContain('notes.md:1:Find Me here');
  const regex = await exec('search_code', { regex: { pattern: 'F[a-z]+d', flags: '' } });
  expect(regex.output).toContain('notes.md:1');
});

test('git_log shows recent commits', async () => {
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: projectRoot,
      env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' },
    });
  git('init', '-q');
  await fs.writeFile(path.join(projectRoot, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first commit');
  await fs.writeFile(path.join(projectRoot, 'a.txt'), 'b\n');
  git('commit', '-q', '-am', 'second commit');
  const result = await exec('git_log', { limit: 1 });
  expect(result.output).toContain('second commit');
  expect(result.output).not.toContain('first commit');
});
