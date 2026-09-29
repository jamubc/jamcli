import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dir, '../..');
/** Pages that describe the product as it is. The changelog and the harness specification record the past on purpose. */
const RECORDS = new Set(['docs/CHANGELOG.md', 'docs/harness-spec.md']);
const pages = ['README.md', ...fs.readdirSync(path.join(root, 'docs')).filter((file) => file.endsWith('.md')).map((file) => `docs/${file}`)].filter((page) => !RECORDS.has(page));

test('every file the README and the docs name, by path or by link, exists', () => {
  const missing: string[] = [];
  for (const page of pages) {
    const text = fs.readFileSync(path.join(root, page), 'utf8');
    const named = [
      ...[...text.matchAll(/`((?:src|scripts|openspec|docs|site)\/[\w./-]+\.[a-z]+)(?::\d+(?:-\d+)?)?`/g)].map((match) => match[1]!),
      ...[...text.matchAll(/\]\(((?:\.\.?\/)?[\w./-]+\.md)(?:#[\w-]+)?\)/g)].map((match) => path.join(path.dirname(page), match[1]!)),
    ];
    for (const file of named) if (!fs.existsSync(path.join(root, file))) missing.push(`${page} names ${file}`);
  }
  expect(missing).toEqual([]);
});
