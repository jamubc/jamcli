/**
 * Fails when a page points at code that is no longer there.
 *
 * Every <Receipt path symbol> must name a file that exists in the repository and, when a
 * symbol is given, a file that still contains it. Every other `src/...` path a page
 * mentions, in prose or in a command, must exist too, except on a line that says "new file".
 * Run before each build.
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

const attribute = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
/** `toolGuidance()` is found as `toolGuidance`; a symbol is matched as written otherwise. */
const searchable = (symbol: string) => symbol.replace(/\(\)$/, '');

const problems: string[] = [];
let receipts = 0;
let paths = 0;

for (const page of pages) {
  const text = fs.readFileSync(page, 'utf8');
  const where = path.relative(siteRoot, page);

  for (const [tag] of text.matchAll(/<Receipt\b[^>]*\/>/g)) {
    receipts += 1;
    const file = attribute(tag, 'path');
    const symbol = attribute(tag, 'symbol');
    if (!file) {
      problems.push(`${where}: a Receipt has no path: ${tag}`);
      continue;
    }
    const full = path.join(repoRoot, file);
    if (!fs.existsSync(full)) {
      problems.push(`${where}: ${file} does not exist`);
      continue;
    }
    if (symbol && fs.statSync(full).isFile() && !fs.readFileSync(full, 'utf8').includes(searchable(symbol))) {
      problems.push(`${where}: ${file} no longer contains ${symbol}`);
    }
  }

  for (const line of text.split('\n')) {
    // A guide's example names a file the reader is about to create: its line says "new file".
    if (line.includes('new file')) continue;
    for (const [mention] of line.matchAll(/\bsrc\/[\w./-]*\w/g)) {
      paths += 1;
      if (!fs.existsSync(path.join(repoRoot, mention))) problems.push(`${where}: ${mention} does not exist`);
    }
  }
}

if (problems.length) {
  console.error(`${problems.length} stale reference${problems.length === 1 ? '' : 's'}:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`${pages.length} pages, ${receipts} receipts, ${paths} path mentions: all resolve.`);
