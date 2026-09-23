import { expect, test } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../tools/registry.js';

/**
 * Acceptance checks for the defects recorded in
 * openspec/changes/rehaul-jamcli/audit.md. Each starts as a todo so every checkpoint
 * stays green, and becomes a live test in the task that fixes it, named in parentheses.
 * A todo left here at archive time means the finding is still open.
 */

const pending = () => {};

const withProject = async (run: (root: string) => Promise<void>) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jamcli-audit-'));
  try {
    await run(root);
  } finally {
    await fs.remove(root);
  }
};

test.todo('F1: the interface offers the full tool set with Ollama and any wording (2.11, 6.4)', pending);
test.todo('F2: headless and ACP offer write and execute tools from the registry (2.12, 2.13)', pending);
test.todo('F3: headless and ACP advertise real tool schemas (2.12, 2.13)', pending);

test('F4: write_file creates a file under the project root (2.2)', () =>
  withProject(async (root) => {
    const result = await createBuiltinRegistry().execute('write_file', { path: 'hello.txt', content: 'hi\n' }, { projectRoot: root });
    expect(result.success).toBe(true);
    expect(await fs.readFile(path.join(root, 'hello.txt'), 'utf-8')).toBe('hi\n');
  }));

test('F5: edit replacements keep $$, $&, $` and $\' literally (2.3)', () =>
  withProject(async (root) => {
    await fs.writeFile(path.join(root, 'run.sh'), 'echo PID\n');
    const replacement = 'echo "pid=$$ match=$&"';
    await createBuiltinRegistry().execute(
      'edit',
      { path: 'run.sh', find_string: 'echo PID', replace_string: replacement },
      { projectRoot: root }
    );
    expect(await fs.readFile(path.join(root, 'run.sh'), 'utf-8')).toBe(`${replacement}\n`);
  }));

test.todo('F6: an ACP session sends earlier turns with the second prompt (2.13)', pending);
test.todo('F7: tool steps stream, keep text beside calls, and send the system prompt first (2.9)', pending);
test.todo('F8: calls after an approval request still run or are answered (2.9)', pending);
test.todo('F9: a read-edit-test cycle completes under the default loop limits (2.9)', pending);
test.todo('F10: --allow-tool run_command runs the command headlessly (2.12)', pending);
test('F11: run_command reports exit codes and times out (2.5)', () =>
  withProject(async (root) => {
    const registry = createBuiltinRegistry();
    const failed = await registry.execute('run_command', { command: 'exit 4' }, { projectRoot: root });
    expect(failed.status).toBe('error');
    expect(failed.output).toContain('Exit code 4');
    const slow = await registry.execute('run_command', { command: 'sleep 30', timeout_ms: 200 }, { projectRoot: root });
    expect(slow.status).toBe('timeout');
  }));
test('F12: grep finds a match past the 400th file and honors .gitignore (2.6)', () =>
  withProject(async (root) => {
    for (let i = 0; i < 450; i += 1) await fs.writeFile(path.join(root, `f${String(i).padStart(3, '0')}.txt`), 'x\n');
    await fs.writeFile(path.join(root, 'f449.txt'), 'target\n');
    await fs.writeFile(path.join(root, '.gitignore'), 'secret.txt\n');
    await fs.writeFile(path.join(root, 'secret.txt'), 'target\n');
    for (const backend of ['builtin', 'auto'] as const) {
      const result = await createBuiltinRegistry().execute(
        'grep',
        { pattern: 'target' },
        { projectRoot: root, ignorePatterns: [], searchBackend: backend }
      );
      expect(result.output).toContain('f449.txt:1:target');
      expect(result.output).not.toContain('secret.txt');
    }
  }));
test.todo('F13: ACP uses the configured provider (2.13)', pending);
test.todo('F14: reasoning is not replayed to another provider family (2.8)', pending);
test.todo('F15: a failed request reports the provider error body, and 429 retries (2.8)', pending);
test.todo('F16: interface turns apply rules, hooks, and the trust gate (2.11, 6.4)', pending);
test.todo('F17: resume restores tool calls and results (2.10)', pending);
test.todo('F18: a created .jamcli directory ignores itself (5.1)', pending);
test.todo('F19: Ollama requests carry num_ctx (2.8)', pending);
test.todo('F20: compaction never separates a tool call from its result (4.3)', pending);
test.todo('F21: tool output is escaped and bounded in the classifier prompt (2.11)', pending);

test('F22: a symbolic link out of the project is refused (2.4)', () =>
  withProject(async (root) => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'jamcli-audit-outside-'));
    try {
      await fs.writeFile(path.join(outside, 'secret'), 'SECRET');
      await fs.symlink(outside, path.join(root, 'link'));
      const result = await createBuiltinRegistry().execute('read_file', { path: 'link/secret' }, { projectRoot: root });
      expect(result.success).toBe(false);
      expect(result.output).not.toContain('SECRET');
    } finally {
      await fs.remove(outside);
    }
  }));

test.todo('F23: MCP servers do not receive provider keys and run on every surface (2.11, 3.5)', pending);
test.todo('F24: @ references expand on every surface (2.11)', pending);
test.todo('F25: a failing hook is a notice, not assistant text (2.11)', pending);
