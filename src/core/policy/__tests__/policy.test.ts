import { test, expect } from 'bun:test';
import { narrowForChild, resolveToolPolicy } from '../index.js';

test('a read-only tool is allowed without asking', () => {
  const resolution = resolveToolPolicy('read_file');
  expect(resolution.decision).toBe('allow');
});

test('state-changing tools ask by default', () => {
  expect(resolveToolPolicy('apply_patch').decision).toBe('ask');
  expect(resolveToolPolicy('run_command').decision).toBe('ask');
});

test('an unknown tool asks rather than running unguarded', () => {
  expect(resolveToolPolicy('mystery_tool').decision).toBe('ask');
});

test('deny wins over any configuration', () => {
  const resolution = resolveToolPolicy('read_file', {
    permissions: { read_file: { allowed: true, require_approval: false } },
    allowTools: ['read_file'],
    denyTools: ['read_file'],
  });
  expect(resolution.decision).toBe('deny');
  expect(resolution.reason).toContain('deny override');
});

test('configuration can deny a tool outright', () => {
  const resolution = resolveToolPolicy('read_file', { permissions: { read_file: false } });
  expect(resolution.decision).toBe('deny');
  expect(resolution.reason).toContain('configuration denies');
});

test('an explicit allow list denies everything it omits', () => {
  const listed = resolveToolPolicy('read_file', { allowTools: ['read_file'] });
  const omitted = resolveToolPolicy('grep', { allowTools: ['read_file'] });
  expect(listed.decision).toBe('allow');
  expect(omitted.decision).toBe('deny');
});

test('a delegated run cannot widen a write permission into a silent allow', () => {
  const parent = resolveToolPolicy('apply_patch', {
    permissions: { apply_patch: { allowed: true, require_approval: false } },
  });
  expect(parent.decision).toBe('allow');
  const child = narrowForChild([parent]);
  expect(child[0].decision).toBe('ask');
  expect(child[0].reason).toContain('cannot widen permissions');
});

test('a delegated run keeps read-only allowances', () => {
  const child = narrowForChild([resolveToolPolicy('read_file')]);
  expect(child[0].decision).toBe('allow');
});
