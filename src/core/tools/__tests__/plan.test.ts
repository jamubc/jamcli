import { test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';
import { askUserRequest, pinnedState, planFile } from '../plan.js';
import type { ElicitationAnswer, ElicitationRequest } from '../../mcp/connect.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-plan-'));
});
afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

test('the plan is written to the project, read back with the person\'s edits, and reported by path', async () => {
  const registry = createBuiltinRegistry();
  const write = await registry.execute('plan_write', { content: '# Plan\n1. Edit a.ts' }, { projectRoot });
  expect(write.success).toBe(true);
  expect(write.output).toContain('Plan saved to .jamcli/plan.md (2 lines)');
  expect(fs.readFileSync(planFile(projectRoot), 'utf8')).toBe('# Plan\n1. Edit a.ts\n');
  fs.appendFileSync(planFile(projectRoot), '2. Also b.ts\n');
  // The plan is a project file, so the ordinary read tool reads it back, the person's edits included.
  const read = await registry.execute('read_file', { path: '.jamcli/plan.md' }, { projectRoot });
  expect(read.success).toBe(true);
  expect(read.output).toContain('2. Also b.ts');
  // The write is state, offered in plan mode only; the exit asks every time.
  expect(registry.get('plan_write')).toMatchObject({ policy: 'state', modes: ['plan'] });
  expect(registry.get('exit_plan_mode')).toMatchObject({ policy: 'state', alwaysAsks: true, modes: ['plan'] });
});

test('the exit needs a plan, then switches through the runtime and names the next mode', async () => {
  const registry = createBuiltinRegistry();
  const switched: string[] = [];
  const exitPlanMode = () => {
    switched.push('called');
    return { mode: 'accept-edits' };
  };
  const without = await registry.execute('exit_plan_mode', {}, { projectRoot, exitPlanMode });
  expect(without.success).toBe(false);
  expect(without.output).toContain('no plan to hand over');
  expect(switched).toEqual([]);

  await registry.execute('plan_write', { content: 'Plan.' }, { projectRoot });
  const approved = await registry.execute('exit_plan_mode', {}, { projectRoot, exitPlanMode });
  expect(approved.success).toBe(true);
  expect(approved.output).toContain('From the next turn the session is in accept-edits mode');
  expect(approved.metadata).toMatchObject({ mode: 'accept-edits' });
  expect(switched).toEqual(['called']);

  const refused = await registry.execute('exit_plan_mode', {}, { projectRoot, exitPlanMode: () => ({ refusal: 'the session is not in plan mode' }) });
  expect(refused.success).toBe(false);
  expect(refused.output).toContain('the session is not in plan mode');
  const nowhere = await registry.execute('exit_plan_mode', {}, { projectRoot });
  expect(nowhere.output).toContain('cannot leave plan mode from a tool');
});

test('ask_user puts one field to the person: the choices as an enum, or typed text', () => {
  expect(askUserRequest({ question: 'Which store?', choices: ['redis', 'memory', ' '] })).toEqual({
    mode: 'form',
    server: 'JamCLI',
    message: 'Which store?',
    schema: { properties: { answer: { type: 'string', title: 'Your choice', enum: ['redis', 'memory'] } }, required: ['answer'] },
  });
  const typed = askUserRequest({ question: 'What is the endpoint?' }) as Extract<ElicitationRequest, { mode: 'form' }>;
  expect(typed.schema.properties.answer).toEqual({ type: 'string', title: 'Your answer' });
  expect(() => askUserRequest({ question: '  ' })).toThrow('needs a "question"');
});

test('ask_user returns the answer, and says so without an error when no one answers', async () => {
  const registry = createBuiltinRegistry();
  const asked: ElicitationRequest[] = [];
  const answering = (answer: ElicitationAnswer) => async (request: ElicitationRequest) => {
    asked.push(request);
    return answer;
  };
  const chosen = await registry.execute('ask_user', { question: 'Which store?', choices: ['redis', 'memory'] }, { projectRoot, elicit: answering({ action: 'accept', content: { answer: 'redis' } }) });
  expect(chosen).toMatchObject({ success: true, output: 'redis', metadata: { answered: true, answer: 'redis' } });
  expect(asked[0].message).toBe('Which store?');

  const declined = await registry.execute('ask_user', { question: 'Which store?' }, { projectRoot, elicit: answering({ action: 'decline' }) });
  expect(declined.success).toBe(true);
  expect(declined.output).toBe('The person gave no answer and declined the question. State the assumption you will work under, say that it is one, and continue.');
  const cancelled = await registry.execute('ask_user', { question: 'Which store?' }, { projectRoot, elicit: answering({ action: 'cancel' }) });
  expect(cancelled.output).toContain('The person gave no answer. State the assumption');

  const nobody = await registry.execute('ask_user', { question: 'Which store?' }, { projectRoot });
  expect(nobody.success).toBe(true);
  expect(nobody.output).toBe('No one can answer a question on this surface. State the assumption you will work under, say that it is one, and continue.');
  expect(registry.get('ask_user')?.policy).toBe('state');
});

test('the pinned state is the todo list with its checks and where the plan is, within a budget', async () => {
  expect(await pinnedState(projectRoot)).toBeUndefined();
  const registry = createBuiltinRegistry();
  await registry.execute('todo_write', { todos: [{ content: 'Read it', status: 'completed' }, { content: 'Fix it', status: 'in_progress', check: 'bun test passes' }] }, { projectRoot });
  expect(await pinnedState(projectRoot)).toBe('Todo list:\n1. [x] Read it\n2. [~] Fix it\n   check: bun test passes');
  await registry.execute('plan_write', { content: 'A\nB\nC' }, { projectRoot });
  expect(await pinnedState(projectRoot)).toBe('Todo list:\n1. [x] Read it\n2. [~] Fix it\n   check: bun test passes\n\nPlan: .jamcli/plan.md (3 lines). Read it with read_file.');

  // Over the budget, completed items go first, and the model is told how many.
  const many = Array.from({ length: 60 }, (_, index) => ({ content: `${index < 30 ? 'done' : 'open'} item ${index} ${'x'.repeat(100)}`, status: index < 30 ? 'completed' : 'pending' }));
  await registry.execute('todo_write', { todos: many }, { projectRoot });
  const pinned = (await pinnedState(projectRoot))!;
  expect(pinned.length).toBeLessThan(4_300);
  expect(pinned).toMatch(/^Todo list \(\d+ items left out here; todo_read has them all\):/);
  expect(pinned).not.toContain('done item 0 ');
  expect(pinned).toContain('open item 59 ');
});
