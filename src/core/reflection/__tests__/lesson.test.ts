import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { appendUnder, planLesson } from '../lesson.js';
import type { Signal } from '../signals.js';

let root: string;
const signals: Signal[] = [{ id: 3, kind: 'tool_error', tool: 'run_command', confidence: 'high', detail: 'npm test failed' }];
const lesson = { finding: 'I ran npm; the project uses bun.', cites: [3], file: 'AGENTS.md', section: 'Commands', add: '- Run tests with `bun test`; npm is not installed here.' };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-lesson-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('a lesson citing its signals is planned as a diff', () => {
  const plan = planLesson(lesson, { projectRoot: root, signals, known: [] });
  expect(plan.ok).toBe(true);
  if (plan.ok) expect(plan.lesson.diff).toContain('+- Run tests with `bun test`');
});

test('an invented citation is refused', () => {
  const plan = planLesson({ ...lesson, cites: [3, 99] }, { projectRoot: root, signals, known: [] });
  expect(plan).toEqual({ ok: false, reason: expect.stringContaining('99') });
});

test('no citation is refused', () => {
  expect(planLesson({ ...lesson, cites: [] }, { projectRoot: root, signals, known: [] }).ok).toBe(false);
});

test('a lesson already written down is refused', () => {
  const known = ['## Testing\n\nRun tests with `bun test`. npm is not installed here.'];
  const plan = planLesson(lesson, { projectRoot: root, signals, known });
  expect(plan.ok).toBe(false);
  if (!plan.ok) expect(plan.reason).toContain('Already written down');
});

test('a lesson only changes markdown inside the project', () => {
  expect(planLesson({ ...lesson, file: 'src/index.ts' }, { projectRoot: root, signals, known: [] }).ok).toBe(false);
  expect(planLesson({ ...lesson, file: '../outside.md' }, { projectRoot: root, signals, known: [] }).ok).toBe(false);
});

test('appending touches only the named section', () => {
  const before = '# Rules\n\n## Commands\n\n- one\n\n## Style\n\n- two\n';
  expect(appendUnder(before, 'commands', '- new')).toBe('# Rules\n\n## Commands\n\n- one\n- new\n\n## Style\n\n- two\n');
  expect(appendUnder(before, 'Missing', '- new')).toBe(`${before.trimEnd()}\n\n## Missing\n\n- new\n`);
});

test('a skill that bundles scripts carries a warning', () => {
  fs.mkdirSync(path.join(root, 'skills', 'pdf'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'pdf', 'SKILL.md'), '---\nname: pdf\n---\n## Steps\n');
  fs.writeFileSync(path.join(root, 'skills', 'pdf', 'extract.py'), '');
  const plan = planLesson({ ...lesson, file: 'skills/pdf/SKILL.md' }, { projectRoot: root, signals, known: [] });
  expect(plan.ok && plan.lesson.warning).toContain('safety');
});
