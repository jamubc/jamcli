import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cleanDraft, commitChanges, draftPrompt, planCommit, withAttribution } from '../commit.js';

let dir: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
const write = (name: string, text: string) => fs.writeFileSync(path.join(dir, name), text);

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-commit-')));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Pat Person');
  git('config', 'user.email', 'pat@example.com');
  write('a.txt', 'one\n');
  write('b.txt', 'two\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a plan shows what a commit would hold, paths included, without staging anything', () => {
  write('a.txt', 'one, staged\n');
  git('add', 'a.txt');
  write('b.txt', 'two, not staged\n');
  const plan = planCommit(dir, ['b.txt']);
  expect(plan.files).toEqual([
    { status: 'M', path: 'a.txt' },
    { status: 'M', path: 'b.txt' },
  ]);
  expect(plan.stat).toContain('2 files changed');
  expect(plan.diff).toContain('+two, not staged');
  // The index is as the person left it: only a.txt is staged.
  expect(git('diff', '--cached', '--name-only')).toBe('a.txt\n');
});

test('a commit stages the paths, runs the hooks, and carries the person\'s identity and no trailer', async () => {
  const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho "pre-commit ran"\ntouch .git/hook-ran\n');
  fs.chmodSync(hook, 0o755);
  write('a.txt', 'changed\n');
  const committed = await commitChanges(dir, 'fix(a): change the first file\n\nBecause it needed changing.', { paths: ['a.txt'] });
  expect(committed.subject).toBe('fix(a): change the first file');
  expect(committed.output).toContain('pre-commit ran');
  expect(fs.existsSync(path.join(dir, '.git', 'hook-ran'))).toBe(true);
  expect(git('log', '-1', '--format=%an <%ae>')).toBe('Pat Person <pat@example.com>\n');
  const body = git('log', '-1', '--format=%B');
  expect(body).toBe('fix(a): change the first file\n\nBecause it needed changing.\n\n');
  expect(body).not.toMatch(/co-authored|generated/i);
  expect(git('rev-parse', 'HEAD').trim()).toBe(committed.sha);
});

test('a trailer is added only when configured, and once', async () => {
  expect(withAttribution('feat: x', undefined)).toBe('feat: x\n');
  expect(withAttribution('feat: x\n', '  ')).toBe('feat: x\n');
  expect(withAttribution('feat: x', 'Co-authored-by: A <a@example.com>')).toBe('feat: x\n\nCo-authored-by: A <a@example.com>\n');
  expect(withAttribution('feat: x\n\nCo-authored-by: A <a@example.com>', 'Co-authored-by: A <a@example.com>')).toBe('feat: x\n\nCo-authored-by: A <a@example.com>\n');
  write('a.txt', 'changed\n');
  await commitChanges(dir, 'feat: with a trailer', { paths: ['a.txt'], attribution: 'Reviewed-by: Sam <sam@example.com>' });
  expect(git('log', '-1', '--format=%(trailers:key=Reviewed-by,valueonly)').trim()).toBe('Sam <sam@example.com>');
});

test('nothing staged, an empty message, or a failing hook is refused with why', async () => {
  await expect(commitChanges(dir, 'feat: nothing')).rejects.toThrow('Nothing is staged, so there is nothing to commit.');
  write('a.txt', 'changed\n');
  await expect(commitChanges(dir, '  \n', { paths: ['a.txt'] })).rejects.toThrow('The commit message is empty.');
  const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho "lint failed: a.txt" >&2\nexit 1\n');
  fs.chmodSync(hook, 0o755);
  await expect(commitChanges(dir, 'feat: blocked', { paths: ['a.txt'] })).rejects.toThrow('lint failed: a.txt');
  expect(git('rev-list', '--count', 'HEAD').trim()).toBe('1');
});

test('a draft request carries the diff and the conventions, and a reply is cleaned of fences and quotes', () => {
  write('a.txt', 'changed\n');
  const prompt = draftPrompt(planCommit(dir, ['a.txt']));
  expect(prompt).toContain('conventional commits');
  expect(prompt).toContain('+changed');
  expect(draftPrompt({ ...planCommit(dir, ['a.txt']), diff: 'x'.repeat(50) }, 10)).toContain('[the rest of the diff is left out]');
  expect(cleanDraft('```\nfix: a\n\nbody\n```')).toBe('fix: a\n\nbody');
  expect(cleanDraft('"fix: a"')).toBe('fix: a');
});
