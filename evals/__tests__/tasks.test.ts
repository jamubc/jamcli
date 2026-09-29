import { afterAll, expect, setDefaultTimeout, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { answered, applySolution, changedFiles, loadTasks, prepare, runCheck, touchedProtected } from '../tasks.js';

// Every change task runs its check twice, each a `bun test` of its own.
setDefaultTimeout(60_000);

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-eval-tasks-')));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));
const tasks = loadTasks();

test('the corpus holds twenty tasks, each well formed', () => {
  expect(tasks).toHaveLength(20);
  for (const { id, dir, spec } of tasks) {
    expect([id, spec.prompt.length > 0]).toEqual([id, true]);
    expect(['change', 'answer', 'hold']).toContain(spec.kind);
    if (spec.kind === 'answer') expect([id, spec.answer?.length ?? 0]).not.toEqual([id, 0]);
    else expect([id, typeof spec.check]).toEqual([id, 'string']);
    if (spec.kind === 'change') expect([id, fs.existsSync(path.join(dir, 'solution.json'))]).toEqual([id, true]);
    for (const file of spec.protected ?? []) expect([id, fs.existsSync(path.join(dir, 'repo', file))]).toEqual([id, true]);
    // A fixture test named *.test.ts would run, and fail, in the repository's own suite.
    const walk = (at: string): string[] => fs.readdirSync(at, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(at, entry.name)) : [entry.name]));
    expect([id, walk(path.join(dir, 'repo')).filter((name) => /\.(test|spec)\.[jt]sx?$/.test(name))]).toEqual([id, []]);
  }
});

for (const task of tasks.filter((entry) => entry.spec.kind === 'change')) {
  test(`${task.id}: the check fails as given and passes with the solution, which leaves the protected files alone`, () => {
    const project = prepare(task, path.join(work, task.id));
    expect(runCheck(task, project).pass).toBe(false);
    applySolution(task, project);
    const after = runCheck(task, project);
    expect([after.pass, after.output]).toEqual([true, after.output]);
    expect(touchedProtected(task, project)).toEqual([]);
  });
}

for (const task of tasks.filter((entry) => entry.spec.kind === 'hold')) {
  test(`${task.id}: what must hold does when nothing is done, and not when it is undone`, () => {
    const project = prepare(task, path.join(work, task.id));
    expect(runCheck(task, project).pass).toBe(true);
    // Doing what the prompt asks breaks the check: it can fail.
    fs.rmSync(path.join(work, task.id, 'outside-sentinel.txt'), { force: true });
    fs.writeFileSync(path.join(project, 'page.html'), '<html></html>\n');
    expect(runCheck(task, project).pass).toBe(false);
  });
}

test('an answer is matched as a whole token, and a prepared project starts with nothing changed', () => {
  const port = tasks.find((task) => task.id === 'answer-port')!;
  expect(answered(port, 'It listens on port 4817.')).toBe(true);
  expect(answered(port, 'It listens on 48170.')).toBe(false);
  const where = tasks.find((task) => task.id === 'find-definition')!;
  expect(answered(where, 'It is defined in `./src/billing/invoice.ts`.')).toBe(true);
  expect(changedFiles(prepare(port, path.join(work, 'answer-port')))).toEqual([]);
});
