/**
 * Fails when a page's proof no longer holds.
 *
 * Every <Proof run> is run from the repository root, once per distinct command, and must exit
 * 0. A proof marked `reader` is one only a reader can run, such as one that needs their own
 * configuration or a file a guide has them create; the page says so, and it is not run here.
 * Run before each build, after the receipt check.
 */
import fs from 'node:fs';
import path from 'node:path';

const siteRoot = path.resolve(import.meta.dir, '..');
const repoRoot = path.resolve(siteRoot, '..');
const contentRoot = path.join(siteRoot, 'src/content/docs');

const pages = fs
  .readdirSync(contentRoot, { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.mdx?$/.test(file))
  .map((file) => path.join(contentRoot, file));

/** Each command, with the pages that prove something by it. */
const proofs = new Map<string, string[]>();
let skipped = 0;

for (const page of pages) {
  const where = path.relative(siteRoot, page);
  for (const [tag] of fs.readFileSync(page, 'utf8').matchAll(/<Proof\b(?:[^>`]|`[^`]*`)*>/g)) {
    const run = /\brun="([^"]*)"/.exec(tag)?.[1] ?? /\brun=\{`([^`]*)`\}/.exec(tag)?.[1];
    if (!run) {
      console.error(`${where}: a Proof has no run: ${tag}`);
      process.exit(1);
    }
    if (/\sreader\b/.test(tag.replace(/`[^`]*`|"[^"]*"/g, ''))) {
      skipped += 1;
      continue;
    }
    proofs.set(run, [...(proofs.get(run) ?? []), where]);
  }
}

const started = Date.now();
const failures: string[] = [];
for (const [run, where] of proofs) {
  const result = Bun.spawnSync(['sh', '-c', run], { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode === 0) continue;
  const output = `${result.stdout.toString()}${result.stderr.toString()}`.trimEnd().split('\n').slice(-15);
  failures.push(`${where.join(', ')}: \`${run}\` exited ${result.exitCode}\n${output.map((line) => `    ${line}`).join('\n')}`);
}

if (failures.length) {
  console.error(`${failures.length} proof${failures.length === 1 ? '' : 's'} failed:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`${proofs.size} proofs ran and held in ${seconds}s; ${skipped} left for the reader.`);
