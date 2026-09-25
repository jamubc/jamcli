import { expect, test } from 'bun:test';
import path from 'node:path';

const repo = path.join(import.meta.dir, '../../..');

test('importing the command line does not load the ACP SDK', () => {
  // A fresh process, so no other test file can have loaded the SDK already.
  const probe = Bun.spawnSync(
    ['bun', '-e', "await import('./src/cli.ts'); console.log(Object.keys(require.cache).filter((key) => key.includes('agentclientprotocol')).length);"],
    { cwd: repo, stdout: 'pipe', stderr: 'pipe' }
  );
  expect(probe.stderr.toString()).toBe('');
  expect(probe.exitCode).toBe(0);
  expect(probe.stdout.toString().trim()).toBe('0');
}, 20_000);
