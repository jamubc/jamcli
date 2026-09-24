import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JAMCLI_VERSION } from '../core/version.js';
import { USAGE, parseArgs } from '../cli.js';
import { startFakeProvider } from '../testing/fakeProvider.js';

const ENTRY = path.join(import.meta.dir, '../index.tsx');

test('the entry point loads nothing until it has read the arguments', () => {
  const source = fs.readFileSync(ENTRY, 'utf8');
  expect(source).not.toMatch(/^\s*import\s/m);
  expect(source).toContain("await import('./tui/start.js')");
});

test('--version and -v print the recorded version', async () => {
  for (const flag of ['--version', '-v']) {
    const child = Bun.spawn(['bun', ENTRY, flag], { stdout: 'pipe', stderr: 'pipe' });
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(code).toBe(0);
    expect(out).toBe(`${JAMCLI_VERSION}\n`);
  }
});

test('--help reaches the command line without the interface', async () => {
  const child = Bun.spawn(['bun', ENTRY, '--help'], { stdout: 'pipe', stderr: 'pipe' });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(code).toBe(0);
  expect(out).toContain('Usage: jamcli');
});

test('every subcommand the usage lists reaches the command line', async () => {
  const source = fs.readFileSync(ENTRY, 'utf8');
  const subcommands = [...USAGE.matchAll(/^ {2}jamcli ([a-z]+)/gm)].map((match) => match[1]);
  expect(subcommands).toEqual(expect.arrayContaining(['sessions', 'audit', 'config', 'mcp', 'acp']));
  for (const name of subcommands) expect(source).toContain(`'${name}',`);

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-entry-'));
  try {
    const child = Bun.spawn(['bun', ENTRY, 'config', 'get', 'model'], {
      cwd,
      env: { ...process.env, JAMCLI_CONFIG_DIR: path.join(cwd, 'user') },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [err, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(err).toBe('model is not set.\n');
    expect(code).toBe(1);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('-v and -vv show the log on standard error, and --trace-file keeps the spans', async () => {
  const server = startFakeProvider();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-entry-observe-'));
  try {
    const userDir = path.join(cwd, 'user');
    fs.mkdirSync(userDir);
    fs.writeFileSync(path.join(userDir, 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, model: 'ollama:fake-model' }));
    const run = async (...args: string[]) => {
      const child = Bun.spawn(['bun', ENTRY, ...args], {
        cwd,
        env: { ...process.env, JAMCLI_CONFIG_DIR: userDir, JAMCLI_STATE_DIR: path.join(cwd, 'state') },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { out, err, code };
    };
    server.enqueue({ text: 'first' }, { text: 'second' });
    const trace = path.join(cwd, 'trace.jsonl');
    const info = await run('-p', 'say hi', '-v', '--trace-file', trace);
    expect(info).toMatchObject({ code: 0, out: 'first\n' });
    expect(info.err).toContain('[info] session started');
    expect(info.err).not.toContain('say hi');
    const names = fs.readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line).name);
    expect(names).toEqual(['chat fake-model', 'invoke_agent jamcli', 'session']);

    const debug = await run('-p', 'say hi', '-vv');
    expect(debug.err).toMatch(/\[debug\] prompt session=\S+ text=say hi\n/);
    expect(debug.err).not.toContain('undefined');
    // Without --log-file, the log is the day's file in the state directory.
    expect(fs.readdirSync(path.join(cwd, 'state', 'logs'))).toEqual([`${new Date().toISOString().slice(0, 10)}.jsonl`]);
  } finally {
    server.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  expect(parseArgs(['-p', 'x', '-v']).verbosity).toBe(1);
  expect(parseArgs(['-v']).version).toBe(true);
  expect(parseArgs(['-vv', '--verbose']).verbosity).toBe(3);
  expect(parseArgs(['--log-file']).unknown).toEqual(['--log-file needs a path']);
});
