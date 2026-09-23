import { test, expect } from 'bun:test';
import { createBuiltinRegistry } from '../registry.js';
import type { ToolPolicyClass } from '../../../types/tools.js';

test('the new harness tools are registered with the required policy class', () => {
  const registry = createBuiltinRegistry();
  const expected: Record<string, ToolPolicyClass> = {
    glob: 'read',
    grep: 'read',
    read_file: 'read',
    edit: 'write',
    todo_read: 'read',
    todo_write: 'write',
    git_status: 'read',
    git_diff: 'read',
  };

  for (const [name, policy] of Object.entries(expected)) {
    const tool = registry.get(name);
    expect(tool).toBeDefined();
    expect(tool!.policy).toBe(policy);
    expect(tool!.inputSchema.type).toBe('object');
  }
});
