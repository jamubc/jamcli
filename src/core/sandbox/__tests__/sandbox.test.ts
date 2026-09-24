import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { bwrapArgs, detectSandbox, seatbeltProfile } from '../index.js';
import { createBuiltinRegistry } from '../../tools/registry.js';

let base: string;
let home: string;
let project: string;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-sandbox-')));
  home = path.join(base, 'home');
  project = path.join(base, 'project');
  fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
  fs.writeFileSync(path.join(home, '.netrc'), 'machine x password y');
  fs.mkdirSync(project);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

const pairs = (args: string[], flag: string) => args.flatMap((arg, i) => (arg === flag ? [args.slice(i + 1, i + 3)] : []));

test('bubblewrap binds everything read-only, the project writable, and hides credentials', () => {
  const args = bwrapArgs({ projectRoot: project, executable: 'bwrap', home, writable: ['~/cache'] }, 'npm test', project);
  expect(args.slice(0, 3)).toEqual(['--ro-bind', '/', '/']);
  expect(args).toContain('--unshare-net');
  // Its own process tree, so no other process's environment or memory is visible.
  expect(args).toContain('--unshare-pid');
  expect(args).toContain('--die-with-parent');
  expect(pairs(args, '--bind')).toEqual([[project, project]]);
  const tmpfs = args.flatMap((arg, i) => (arg === '--tmpfs' ? [args[i + 1]] : []));
  expect(tmpfs).toContain(path.join(home, '.ssh'));
  if (fs.existsSync('/run')) expect(tmpfs).toContain('/run');
  expect(pairs(args, '--ro-bind')).toContainEqual(['/dev/null', path.join(home, '.netrc')]);
  expect(args.slice(-6)).toEqual(['--chdir', project, '--', '/bin/sh', '-c', 'npm test']);
  // Hidden mounts come after the writable binds, so they win.
  expect(args.lastIndexOf(path.join(home, '.ssh'))).toBeGreaterThan(args.lastIndexOf('--bind'));

  fs.mkdirSync(path.join(home, 'cache'));
  const widened = bwrapArgs({ projectRoot: project, executable: 'bwrap', home, writable: ['~/cache'], network: true }, 'ls', project);
  expect(widened).not.toContain('--unshare-net');
  expect(pairs(widened, '--bind')).toContainEqual([path.join(home, 'cache'), path.join(home, 'cache')]);
});

test('the Seatbelt profile denies by default, writes only where allowed, and hides credentials last', () => {
  const quoted = path.join(base, 'a "quoted" dir');
  fs.mkdirSync(quoted);
  const profile = seatbeltProfile({ projectRoot: quoted, home });
  const lines = profile.split('\n');
  expect(lines.slice(0, 2)).toEqual(['(version 1)', '(deny default)']);
  expect(profile).toContain(`(subpath "${quoted.replace(/"/g, '\\"')}")`);
  expect(lines.findIndex((line) => line.startsWith('(deny file-read*'))).toBeGreaterThan(lines.indexOf('(allow file-read*)'));
  expect(profile).toContain(`(subpath "${path.join(home, '.ssh')}")`);
  expect(profile).toContain(`(literal "${path.join(home, '.netrc')}")`);
  expect(profile).not.toContain('(allow network*)');
  expect(seatbeltProfile({ projectRoot: project, home, network: true })).toContain('(allow network*)');
});

test('detection reports what it found and why', () => {
  expect(detectSandbox({ projectRoot: project, settings: { enabled: false } })).toMatchObject({ kind: 'none', reason: expect.stringContaining('sandbox.enabled') });
  expect(detectSandbox({ projectRoot: project, platform: 'win32' })).toMatchObject({ kind: 'none', reason: 'there is no sandbox for win32' });
  expect(detectSandbox({ projectRoot: project, platform: 'linux', env: { PATH: base } })).toMatchObject({ kind: 'none', reason: 'bubblewrap (bwrap) is not installed' });
  if (!fs.existsSync('/usr/bin/sandbox-exec')) {
    expect(detectSandbox({ projectRoot: project, platform: 'darwin' }).reason).toBe('/usr/bin/sandbox-exec is missing');
  }
});

const bwrap = detectSandbox({ projectRoot: os.tmpdir() });

test.skipIf(bwrap.kind !== 'bwrap')('a command in the sandbox can write the project but not outside it, and a failure says why', async () => {
  const sandbox = detectSandbox({ projectRoot: project });
  const run = (command: string) =>
    createBuiltinRegistry().execute('run_command', { command }, { projectRoot: project, wrapCommand: sandbox.wrap, sandboxNote: sandbox.note });
  const inside = await run('echo hi > inside.txt && cat inside.txt');
  expect(inside.success).toBe(true);
  expect(fs.readFileSync(path.join(project, 'inside.txt'), 'utf8')).toBe('hi\n');
  // /tmp is private to the sandbox: the write succeeds there and never reaches the real one.
  await run(`touch ${path.join(base, 'escaped.txt')}`);
  expect(fs.existsSync(path.join(base, 'escaped.txt'))).toBe(false);
  // Everything else outside the project is read-only, and the failure names the sandbox.
  const probe = path.join(os.homedir(), `.jamcli-sandbox-probe-${process.pid}`);
  try {
    const outside = await run(`touch ${probe}`);
    expect(outside.success).toBe(false);
    expect(fs.existsSync(probe)).toBe(false);
    expect(outside.output).toContain('Read-only file system');
    expect(outside.output).toContain('bubblewrap sandbox with the network off');
  } finally {
    fs.rmSync(probe, { force: true });
  }
});
