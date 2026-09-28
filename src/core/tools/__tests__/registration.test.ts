import { test, expect } from 'bun:test';
import { createBuiltinRegistry } from '../registry.js';
import type { RegisteredToolClass } from '../../../types/tools.js';

test('the new harness tools are registered with the required policy class', () => {
  const registry = createBuiltinRegistry();
  const expected: Record<string, RegisteredToolClass> = {
    glob: 'read',
    grep: 'read',
    read_file: 'read',
    edit: 'write',
    write_file: 'write',
    apply_patch: 'write',
    run_command: 'execute',
    todo_read: 'read',
    todo_write: 'state',
    git_status: 'read',
    git_diff: 'read',
    task: 'delegate',
    task_status: 'read',
    task_cancel: 'delegate',
    delegate: 'delegate',
  };

  for (const [name, policy] of Object.entries(expected)) {
    const tool = registry.get(name);
    expect(tool).toBeDefined();
    expect(tool!.policy).toBe(policy);
    expect(tool!.inputSchema.type).toBe('object');
  }
});

test('the built-in tools load on their own, before the registry module', () => {
  // A fresh process, so no earlier import has already settled the order.
  const run = Bun.spawnSync(['bun', '-e', "const { BUILTIN_TOOLS } = await import('./src/core/tools/builtins.ts'); console.log(BUILTIN_TOOLS.length)"], {
    cwd: new URL('../../../../', import.meta.url).pathname,
  });
  expect(run.stderr.toString()).toBe('');
  expect(Number(run.stdout.toString())).toBeGreaterThan(0);
});
