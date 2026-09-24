import { afterAll, beforeAll, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { bwrapSandbox, detectSandbox, subprocessEnv } from '../index.js';
import { createBuiltinRegistry } from '../../tools/registry.js';

/**
 * A hostile command tries every escape the sandbox exists to stop: reading credentials,
 * writing outside the project, reaching the network, reading a provider key, and
 * reaching an agent through a Unix socket. Each attempt must fail under bubblewrap.
 */

const detected = detectSandbox({ projectRoot: os.tmpdir(), platform: process.platform });
const executable = detected.kind === 'bwrap' ? detected.reason.replace('bubblewrap at ', '') : '';

if (detected.kind !== 'bwrap') {
  test.skip(`sandbox escape tests need bubblewrap, and here ${detected.reason}`, () => {});
} else {
  const SECRET = `planted-secret-${process.pid}`;
  let base: string;
  let home: string;
  let project: string;
  let outside: string;
  let tcp: ReturnType<typeof Bun.serve>;
  const sockets: { stop(): void }[] = [];

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-escape-')));
    home = path.join(base, 'home');
    project = path.join(base, 'project');
    // Outside /tmp, which the sandbox replaces, so these paths are the real ones.
    outside = fs.mkdtempSync(path.join('/var/tmp', 'jamcli-escape-'));
    fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
    fs.mkdirSync(path.join(home, '.aws'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ssh', 'id_rsa'), SECRET);
    fs.writeFileSync(path.join(home, '.aws', 'credentials'), SECRET);
    fs.writeFileSync(path.join(home, '.netrc'), SECRET);
    fs.mkdirSync(project);
    tcp = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reached') });
    for (const name of ['agent.sock', 'daemon.sock']) {
      sockets.push(
        Bun.listen({ unix: path.join(outside, name), socket: { open: (socket) => void socket.write('reached'), data: () => {} } })
      );
    }
  });

  afterAll(() => {
    tcp?.stop(true);
    for (const socket of sockets) socket.stop();
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const run = async (command: string, extra: Record<string, string | undefined> = {}) => {
    const sandbox = bwrapSandbox({ projectRoot: project, executable, home, hidden: [path.join(outside, 'daemon.sock')] });
    const env = subprocessEnv({ ...process.env, HOME: home, ...extra });
    const result = await createBuiltinRegistry().execute('run_command', { command }, { projectRoot: project, env, wrapCommand: sandbox.wrap });
    return result.output;
  };

  /** A script that reports whether it could connect: to a Unix socket path, or to a port on the loopback. */
  const connectScript = (...target: (string | number)[]) =>
    `require('net').connect(${target.map((part) => JSON.stringify(part)).join(', ')})` +
    `.on('connect', () => { console.log('REACHED'); process.exit(0); })` +
    `.on('data', () => { console.log('REACHED'); process.exit(0); })` +
    // A reset can only follow a connection, so it counts as reaching the other side.
    `.on('error', (e) => { console.log(e.code === 'ECONNRESET' ? 'REACHED' : 'BLOCKED ' + e.code); process.exit(0); });`;

  test('credentials in the home directory read as empty', async () => {
    const output = await run('cat ~/.ssh/id_rsa ~/.aws/credentials ~/.netrc; ls -a ~/.ssh');
    expect(output).not.toContain(SECRET);
    expect(output).not.toContain('id_rsa\n');
  });

  test('nothing outside the project can be written, and the project can', async () => {
    const targets = [path.join(home, 'pwned'), path.join(outside, 'pwned'), `/etc/jamcli-pwned-${process.pid}`];
    await run(targets.map((target) => `touch ${target}`).join('; ') + '; echo ok > inside.txt');
    for (const target of targets) expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(path.join(project, 'inside.txt'), 'utf8')).toBe('ok\n');
  });

  test('the network is unreachable, even the host loopback', async () => {
    fs.writeFileSync(path.join(project, 'net.js'), connectScript(tcp.port!, '127.0.0.1'));
    const output = await run(`"${process.execPath}" net.js`);
    expect(output).toContain('BLOCKED');
    expect(output).not.toContain('REACHED');
  });

  test('a provider key in the parent environment does not reach the command', async () => {
    const output = await run('echo "[$ANTHROPIC_API_KEY]"; env', { ANTHROPIC_API_KEY: `planted-key-${process.pid}` });
    expect(output).toContain('[]');
    expect(output).not.toContain(`planted-key-${process.pid}`);
  });

  test('the SSH agent and hidden sockets cannot be reached', async () => {
    fs.writeFileSync(path.join(project, 'agent.js'), connectScript(path.join(outside, 'agent.sock')));
    fs.writeFileSync(path.join(project, 'daemon.js'), connectScript(path.join(outside, 'daemon.sock')));
    const agent = await run(`"${process.execPath}" agent.js`, { SSH_AUTH_SOCK: path.join(outside, 'agent.sock') });
    const daemon = await run(`"${process.execPath}" daemon.js`);
    expect(agent).toContain('BLOCKED');
    expect(daemon).toContain('BLOCKED');
  });
}
