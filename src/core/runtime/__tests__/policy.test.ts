import { expect, test } from 'bun:test';
import { createToolPolicy, type ToolPolicyOptions } from '../policy.js';

const classes: Record<string, 'read' | 'write' | 'execute'> = {
  read_file: 'read',
  glob: 'read',
  list_files: 'read',
  edit: 'write',
  apply_patch: 'write',
  run_command: 'execute',
};

const policy = (options: Partial<ToolPolicyOptions> = {}) =>
  createToolPolicy({
    classOf: (tool) => classes[tool] ?? 'unknown',
    namesOf: (tool) => (tool === 'glob' || tool === 'list_files' ? ['glob', 'list_files'] : [tool]),
    known: (name) => name in classes,
    ...options,
  });

// The configuration every project starts with, as .jamcli/mcp.json writes it.
const defaults = {
  read_file: { allowed: true, require_approval: false },
  list_files: { allowed: true, require_approval: false },
  apply_patch: { allowed: true, require_approval: true },
  run_command: { allowed: true, require_approval: true },
};

test('reads run and state changes ask by default', () => {
  expect(policy().decide('read_file').decision).toBe('allow');
  expect(policy().decide('edit')).toMatchObject({ decision: 'ask', by: 'policy', reason: 'tools that change state ask first' });
  expect(policy().decide('mystery').decision).toBe('ask');
});

test('--allow-tool allows a tool the configuration asks for, and restricts nothing else (F10)', () => {
  const run = policy({ permissions: defaults, allowTools: ['run_command'] });
  expect(run.decide('run_command')).toMatchObject({ decision: 'allow', by: 'flag', rule: '--allow-tool run_command' });
  expect(run.decide('read_file').decision).toBe('allow');
  expect(run.decide('glob').decision).toBe('allow');
  expect(run.decide('apply_patch').decision).toBe('ask');
  expect(run.decide('edit').decision).toBe('ask');
});

test('flags accept comma-separated lists', () => {
  const run = policy({ allowTools: ['edit, run_command'] });
  expect(run.decide('edit').decision).toBe('allow');
  expect(run.decide('run_command').decision).toBe('allow');
});

test('a deny always wins, from a flag or from the configuration', () => {
  expect(policy({ allowTools: ['edit'], denyTools: ['edit'] }).decide('edit')).toMatchObject({ decision: 'deny', by: 'flag' });
  const configured = policy({ permissions: { run_command: false }, allowTools: ['run_command'] });
  expect(configured.decide('run_command')).toMatchObject({ decision: 'deny', by: 'policy', rule: 'tools.run_command' });
  expect(policy({ permissions: { run_command: { allowed: false } } }).decide('run_command').decision).toBe('deny');
});

test('the configuration can allow a state change without asking', () => {
  expect(policy({ permissions: { apply_patch: { allowed: true, require_approval: false } } }).decide('apply_patch')).toMatchObject({
    decision: 'allow',
    by: 'policy',
    rule: 'tools.apply_patch',
  });
});

test('a setting or flag for an alias applies to the tool it stands for', () => {
  expect(policy({ permissions: { list_files: false } }).decide('glob').decision).toBe('deny');
  expect(policy({ denyTools: ['glob'] }).decide('list_files').decision).toBe('deny');
});

test('flags naming no tool are reported', () => {
  expect(policy({ allowTools: ['edit', 'edt'], denyTools: ['rm_rf'] }).unknownFlags).toEqual(['edt', 'rm_rf']);
});
