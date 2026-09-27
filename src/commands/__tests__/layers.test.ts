import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'path';

const src = path.join(import.meta.dir, '..', '..');
const files = (dir: string) => Array.from(new Bun.Glob('**/*.{ts,tsx}').scanSync({ cwd: path.join(src, dir) })).map((file) => path.join(src, dir, file));

test('the commands import no interface code, so every surface can run them', () => {
  const importingUi = files('commands').filter((file) => /from ['"](react|@opentui\/[a-z]+|[./]*tui\/[^'"]*)['"]/.test(readFileSync(file, 'utf8')));
  expect(importingUi).toEqual([]);
});

test('the core does not import the commands, which are built on it', () => {
  const importingCommands = files('core').filter((file) => /from ['"](\.\.\/)+commands\//.test(readFileSync(file, 'utf8')));
  expect(importingCommands).toEqual([]);
});
