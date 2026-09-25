import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HookTrust, hooksDigest, hooksFromLayers, parseHookOutput, runHookCommand } from '../commands.js';
import { createHookBus, mergeVerdicts } from '../index.js';

let dir: string;

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-hook-commands-')));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const context = () => ({ cwd: dir, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });

test('a hook reads the event on standard input, and its exit code and output say what it decided', async () => {
  const seen = path.join(dir, 'seen.json');
  expect(await runHookCommand({ command: `cat > ${seen}` }, { event: 'pre_tool', tool_name: 'edit' }, context())).toEqual({ kind: 'ok', stdout: '' });
  expect(JSON.parse(fs.readFileSync(seen, 'utf8'))).toEqual({ event: 'pre_tool', tool_name: 'edit' });

  expect(await runHookCommand({ command: 'echo "not on main" >&2; exit 2' }, {}, context())).toEqual({ kind: 'block', reason: 'not on main' });
  expect(await runHookCommand({ command: 'exit 2' }, {}, context())).toEqual({ kind: 'block', reason: 'a hook blocked it' });
  expect(await runHookCommand({ command: 'echo broken >&2; exit 3' }, {}, context())).toEqual({ kind: 'failed', message: 'it exited with 3: broken' });
  expect(await runHookCommand({ command: `echo '{"decision":"deny","reason":"frozen","additional_context":"see RELEASE.md"}'` }, {}, context())).toMatchObject({
    kind: 'ok',
    output: { decision: 'deny', reason: 'frozen', additional_context: 'see RELEASE.md' },
  });
  expect(await runHookCommand({ command: 'echo plain words' }, {}, context())).toEqual({ kind: 'ok', stdout: 'plain words\n' });
  expect(await runHookCommand({ command: `echo '{"decision":"maybe"}'` }, {}, context())).toEqual({ kind: 'failed', message: 'its decision "maybe" is not allow, deny, or ask' });
  expect(await runHookCommand({ command: 'no-such-command-anywhere' }, {}, context())).toMatchObject({ kind: 'failed' });
});

test('a hook that runs too long is stopped and reported, and its children with it', async () => {
  const started = Date.now();
  const pids = path.join(dir, 'pids');
  const run = await runHookCommand({ command: `sleep 5 & echo $! > ${pids}; echo $$ >> ${pids}; sleep 5`, timeout_ms: 200 }, {}, context());
  expect(run).toEqual({ kind: 'failed', message: 'it did not finish within 200 ms' });
  expect(Date.now() - started).toBeLessThan(2_000);
  await Bun.sleep(100);
  // A killed process whose parent is gone can linger as a zombie until something reaps it; it runs nothing.
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
    } catch {
      return false;
    }
    const stat = `/proc/${pid}/stat`;
    return !fs.existsSync(stat) || !/^\d+ \(.*\) Z/.test(fs.readFileSync(stat, 'utf8'));
  };
  const listed = fs.readFileSync(pids, 'utf8').trim().split('\n').map(Number);
  expect(listed).toHaveLength(2);
  expect(listed.filter(alive)).toEqual([]);
});

test('a hook\'s JSON is checked before it counts', () => {
  expect(parseHookOutput('{"updated_input":{"path":"a"}}')).toEqual({ updated_input: { path: 'a' } });
  expect(parseHookOutput('{"updated_input":[1]}')).toBe('its updated_input is not an object');
  expect(parseHookOutput('{"decision":')).toBe('its output starts like JSON but is not JSON');
  expect(parseHookOutput('[]')).toBe('its output is not a JSON object');
});

test('hooks come from each layer with their source, and trust is kept per project for the hooks as they are', () => {
  const hooks = hooksFromLayers([
    { scope: 'default', label: 'defaults', values: {} },
    { scope: 'user', label: '~/.config/jamcli/config.json', values: { hooks: { pre_tool: [{ matcher: 'edit', command: 'guard' }] } } },
    { scope: 'project', label: '.jamcli/config.json', values: { hooks: { stop: [{ command: 'check' }], session_end: [{ command: 'bye', enabled: false }] } } },
  ]);
  expect(hooks).toEqual([
    { matcher: 'edit', command: 'guard', event: 'pre_tool', scope: 'user', source: '~/.config/jamcli/config.json' },
    { command: 'check', event: 'stop', scope: 'project', source: '.jamcli/config.json' },
    { command: 'bye', enabled: false, event: 'session_end', scope: 'project', source: '.jamcli/config.json' },
  ]);
  const digest = hooksDigest(hooks);
  // The user's own hooks do not change what the project is trusted for.
  expect(hooksDigest(hooks.filter((hook) => hook.scope !== 'user'))).toBe(digest);
  expect(hooksDigest([...hooks.slice(0, 1), { ...hooks[1], command: 'check --all' }, hooks[2]])).not.toBe(digest);

  const trust = new HookTrust(path.join(dir, 'state', 'trusted-hooks.json'));
  expect(trust.isTrusted('/work/app', digest)).toBe(false);
  trust.trust('/work/app', digest);
  expect(trust.isTrusted('/work/app', digest)).toBe(true);
  expect(trust.isTrusted('/work/other', digest)).toBe(false);
  expect(trust.isTrusted('/work/app', 'changed')).toBe(false);
  expect(fs.statSync(path.join(dir, 'state', 'trusted-hooks.json')).mode & 0o777).toBe(0o600);
});

test('verdicts combine as rules do: a block first, then deny, ask, allow; context in order', async () => {
  expect(mergeVerdicts([{ decision: 'allow', reason: 'a' }, { decision: 'deny', reason: 'b' }, { decision: 'ask', reason: 'c' }])).toMatchObject({ decision: 'deny', reason: 'b' });
  expect(mergeVerdicts([{ decision: 'allow' }, { decision: 'ask', reason: 'c' }])).toMatchObject({ decision: 'ask', reason: 'c' });
  expect(mergeVerdicts([{ block: 'first' }, { block: 'second' }, { context: ['one'] }, { context: ['two'] }])).toEqual({ block: 'first', context: ['one', 'two'] });
  expect(mergeVerdicts([{ updatedInput: { a: 1 } }, { updatedInput: { a: 2 } }, 'noise', null])).toEqual({ context: [], updatedInput: { a: 2 } });

  const bus = createHookBus();
  bus.on('stop', () => ({ decision: 'deny' }));
  bus.on('stop', () => {
    throw new Error('boom');
  });
  bus.on('stop', () => undefined);
  const collected = await bus.collect('stop', { session: {} as never, response: '', stopHookActive: false });
  expect(collected.results).toEqual([{ decision: 'deny' }]);
  expect(collected.failures.map((failure) => failure.message)).toEqual(['boom']);
});
