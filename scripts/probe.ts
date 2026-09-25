/**
 * Mutation probes: break the code on purpose and check a test notices.
 *
 *   bun scripts/probe.ts probes.json
 *
 * The file is a list of `{ name, file, old, new, tests, timeout? }`. For each probe the
 * first `old` in `file` is replaced by `new`, the named test files run, and the file is
 * put back. A probe whose tests still pass survived: the tests cannot see that break.
 * `openspec/DEFERRED.md` lists the probes this project still owes.
 */
import fs from 'fs';
import path from 'path';

interface Probe {
  name: string;
  file: string;
  old: string;
  new: string;
  tests: string[];
  /** Seconds before a hung run is killed, which counts as caught. Default 180. */
  timeout?: number;
}

const root = path.resolve(import.meta.dir, '..');
const list = process.argv[2];
if (!list) {
  console.error('usage: bun scripts/probe.ts probes.json');
  process.exit(2);
}
const probes: Probe[] = JSON.parse(fs.readFileSync(list, 'utf8'));
const survivors: string[] = [];

for (const probe of probes) {
  const file = path.join(root, probe.file);
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes(probe.old)) {
    console.log(`MISSING  ${probe.name}`);
    survivors.push(`${probe.name} (text not found)`);
    continue;
  }
  fs.writeFileSync(file, original.replace(probe.old, probe.new));
  try {
    const child = Bun.spawn(['bun', 'test', ...probe.tests], { cwd: root, stdout: 'ignore', stderr: 'ignore', detached: true });
    const timer = setTimeout(() => {
      // The whole group, so a server a test started goes too.
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }, (probe.timeout ?? 180) * 1000);
    const code = await child.exited;
    clearTimeout(timer);
    const caught = code !== 0;
    console.log(`${caught ? 'CAUGHT  ' : 'SURVIVED'} ${probe.name}`);
    if (!caught) survivors.push(probe.name);
  } finally {
    fs.writeFileSync(file, original);
  }
}

console.log(survivors.length ? `Survivors: ${survivors.join(', ')}` : 'Every probe was caught.');
process.exit(survivors.length ? 1 : 0);
