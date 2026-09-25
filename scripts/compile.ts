/**
 * Build single-file binaries: `bun run compile [target...]`. Each embeds the Bun runtime,
 * JamCLI, and OpenTUI's native library for its platform, so it runs with nothing installed.
 * The native libraries of every platform must be present first:
 * `bun install --os='*' --cpu='*'`. Writes `release/jamcli-<target>[.exe]` and `release/SHA256SUMS`.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const TARGETS: Record<string, string> = {
  'linux-x64': '@opentui/core-linux-x64',
  'linux-arm64': '@opentui/core-linux-arm64',
  'darwin-x64': '@opentui/core-darwin-x64',
  'darwin-arm64': '@opentui/core-darwin-arm64',
  'windows-x64': '@opentui/core-win32-x64',
};

const repo = path.resolve(import.meta.dir, '..');
const out = path.join(repo, 'release');
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TARGETS);
for (const target of wanted) if (!TARGETS[target]) throw new Error(`Unknown target ${target}. Targets: ${Object.keys(TARGETS).join(', ')}.`);
const missing = wanted.filter((target) => !fs.existsSync(path.join(repo, 'node_modules', TARGETS[target])));
if (missing.length) {
  console.error(`The native library for ${missing.join(', ')} is not installed. Run: bun install --os='*' --cpu='*'`);
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

const sums: string[] = [];
for (const target of wanted) {
  const file = path.join(out, `jamcli-${target}${target.startsWith('windows') ? '.exe' : ''}`);
  const built = Bun.spawnSync(['bun', 'build', '--compile', `--target=bun-${target}`, '--minify', '--loader', '.scm:text', path.join(repo, 'src', 'index.tsx'), '--outfile', file], { cwd: repo, stdout: 'pipe', stderr: 'pipe' });
  if (built.exitCode !== 0) {
    console.error(`${target}: ${built.stderr.toString()}`);
    process.exit(1);
  }
  const sum = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  sums.push(`${sum}  ${path.basename(file)}`);
  console.log(`${path.basename(file)}  ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MiB  ${sum}`);
}
fs.writeFileSync(path.join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);
