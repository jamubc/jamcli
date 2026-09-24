/**
 * Build the command: `bun run build`. Bun bundles JamCLI's own code into `dist/`, with
 * dependencies left to `node_modules` and each lazily loaded part in a chunk of its own,
 * so `jamcli --version` loads no interface. The entry starts with a Bun shebang: the
 * OpenTUI interface needs Bun, so the whole command runs on it, without reading the
 * working directory's .env or bunfig.toml.
 */
import fs from 'fs';
import path from 'path';

const SHEBANG = '#!/usr/bin/env -S bun --no-env-file --config=/dev/null';

const repo = path.resolve(import.meta.dir, '..');
// `bun scripts/build.ts <dir>` builds somewhere else, as the build's own test does.
const outdir = path.resolve(process.argv[2] ?? path.join(repo, 'dist'));
fs.rmSync(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [path.join(repo, 'src', 'index.tsx')],
  outdir,
  target: 'bun',
  format: 'esm',
  splitting: true,
  packages: 'external',
  loader: { '.scm': 'text' },
  naming: { entry: '[name].js', chunk: 'chunks/[name]-[hash].js' },
});
if (!result.success) {
  for (const message of result.logs) console.error(message);
  process.exit(1);
}
// Bun's banner goes on every chunk, and a shebang is valid only on the file that is run.
// Bun reads a .env and a bunfig.toml from the working directory, and a bunfig can preload
// code, so a repository JamCLI is opened in could run its own code before JamCLI's or
// change its settings. The shebang turns both off.
const entry = path.join(outdir, 'index.js');
fs.writeFileSync(entry, `${SHEBANG}\n${fs.readFileSync(entry, 'utf8')}`);
fs.chmodSync(entry, 0o755);
const size = result.outputs.reduce((total, output) => total + output.size, 0);
console.log(`Built ${path.relative(process.cwd(), entry)} and ${result.outputs.length - 1} chunks, ${(size / 1024).toFixed(0)} KiB.`);
