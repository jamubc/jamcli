import { expect, test } from 'bun:test';
import { WorkTable, workNews } from '../work.js';

const entry = (table: WorkTable, id: string, kind: 'job' | 'task' = 'job') => {
  let stopped = false;
  const added = table.add({ id, kind, label: `${kind} ${id}`, record: undefined, stop: () => (stopped = true) });
  return { added, wasStopped: () => stopped };
};

test('what ends is told once, and a listener hears every change', () => {
  const table = new WorkTable();
  const changes: number[] = [];
  const stop = table.watch(() => changes.push(table.running()));
  entry(table, 'job_1');
  entry(table, 'task_1', 'task');
  expect(table.running()).toBe(2);
  expect(table.running('task')).toBe(1);
  expect(table.drainEnded()).toEqual([]);
  table.end('job_1', 'exited with code 0');
  table.end('job_1', 'again');
  expect(table.drainEnded()).toMatchObject([{ id: 'job_1', outcome: 'exited with code 0' }]);
  expect(table.drainEnded()).toEqual([]);
  expect(table.list().map((item) => [item.id, item.outcome])).toEqual([
    ['job_1', 'exited with code 0'],
    ['task_1', undefined],
  ]);
  table.forget('task_1');
  expect(changes).toEqual([1, 2, 1, 0]);
  stop();
  entry(table, 'job_2');
  expect(changes).toHaveLength(4);
});

test('stopping asks the entry, which ends when its tool reports so', () => {
  const table = new WorkTable();
  const one = entry(table, 'job_1');
  expect(table.stop('job_1')).toBe(true);
  expect(one.wasStopped()).toBe(true);
  expect(table.running()).toBe(1);
  table.end('job_1', 'ended by signal SIGTERM');
  expect(table.stop('job_1')).toBe(false);
  expect(table.stop('nope')).toBe(false);
  const two = entry(table, 'job_2');
  table.stopAll();
  expect(two.wasStopped()).toBe(true);
});

test('the news names the entry, how it ended, and the tool that has the rest', () => {
  expect(workNews({ id: 'job_ab12', kind: 'job', label: 'npm start', startedAt: 1_000, endedAt: 43_000, outcome: 'exited with code 1' })).toBe(
    'job_ab12 (npm start) exited with code 1 after 42.0s. Read its output with command_output.'
  );
  expect(workNews({ id: 'task-1', kind: 'task', label: 'reviewer: check', startedAt: 0, endedAt: 500, outcome: 'ok' })).toBe('task-1 (reviewer: check) ok after 0.5s. Collect it with task_result.');
});

test('ended entries the model was told of are forgotten past a limit', () => {
  const table = new WorkTable();
  for (let i = 0; i < 25; i += 1) {
    entry(table, `job_${i}`);
    table.end(`job_${i}`, 'done');
    table.drainEnded();
  }
  entry(table, 'job_last');
  table.end('job_last', 'done');
  expect(table.list().length).toBeLessThanOrEqual(21);
  expect(table.list().some((item) => item.id === 'job_0')).toBe(false);
  expect(table.list().some((item) => item.id === 'job_last')).toBe(true);
});
