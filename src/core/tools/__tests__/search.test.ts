import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';
import { findRipgrep } from '../search.js';

let projectRoot: string;

beforeAll(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jamcli-search-'));
  // 1,000 files; the only match lives in the last one, far past the old 400-file cap.
  await fs.ensureDir(path.join(projectRoot, 'many'));
  for (let i = 0; i < 1000; i += 1) {
    const name = `file-${String(i).padStart(4, '0')}.txt`;
    await fs.writeFile(path.join(projectRoot, 'many', name), i === 999 ? 'needle-in-the-last-file\n' : `hay ${i}\n`);
  }
  // Ignore rules, in a directory that is not a git repository.
  await fs.writeFile(path.join(projectRoot, '.gitignore'), 'build/\n*.log\n');
  await fs.ensureDir(path.join(projectRoot, 'build'));
  await fs.writeFile(path.join(projectRoot, 'build', 'out.txt'), 'needle-ignored-build\n');
  await fs.writeFile(path.join(projectRoot, 'debug.log'), 'needle-ignored-log\n');
  await fs.ensureDir(path.join(projectRoot, 'pkg', 'gen'));
  await fs.writeFile(path.join(projectRoot, 'pkg', '.gitignore'), 'gen/\n');
  await fs.writeFile(path.join(projectRoot, 'pkg', 'gen', 'code.txt'), 'needle-ignored-nested\n');
  await fs.writeFile(path.join(projectRoot, 'pkg', 'kept.txt'), 'needle-kept\nsecond needle-kept line\n');
  // Hidden files and a fake .git directory.
  await fs.writeFile(path.join(projectRoot, '.env.example'), 'needle-hidden\n');
  await fs.ensureDir(path.join(projectRoot, '.git'));
  await fs.writeFile(path.join(projectRoot, '.git', 'config'), 'needle-git-internal\n');
  // A binary file with a match in it.
  await fs.writeFile(path.join(projectRoot, 'blob.bin'), Buffer.concat([Buffer.from('needle-binary'), Buffer.alloc(16)]));
});

afterAll(async () => {
  await fs.remove(projectRoot);
});

const backends: ('ripgrep' | 'builtin')[] = findRipgrep() ? ['ripgrep', 'builtin'] : ['builtin'];

for (const backend of backends) {
  describe(`search with the ${backend} backend`, () => {
    const exec = (tool: string, args: Record<string, unknown>) =>
      createBuiltinRegistry().execute(tool, args, { projectRoot, ignorePatterns: [], searchBackend: backend });

    test('finds a match in the last of 1,000 files', async () => {
      const result = await exec('grep', { pattern: 'needle-in-the-last-file' });
      expect(result.output).toContain('many/file-0999.txt:1:needle-in-the-last-file');
      expect(result.metadata?.backend).toBe(backend);
    });

    test('honors .gitignore at the root and in a subdirectory, outside a git repository', async () => {
      const result = await exec('grep', { pattern: 'needle-(ignored|kept)' });
      expect(result.output).toContain('pkg/kept.txt');
      expect(result.output).not.toContain('needle-ignored');
    });

    test('skips hidden files unless asked, and never searches .git', async () => {
      const hidden = await exec('grep', { pattern: 'needle-hidden' });
      expect(hidden.output).toContain('No matches');
      const shown = await exec('grep', { pattern: 'needle-(hidden|git-internal)', include_hidden: true });
      expect(shown.output).toContain('.env.example:1:needle-hidden');
      expect(shown.output).not.toContain('git-internal');
    });

    test('skips binary files', async () => {
      const result = await exec('grep', { pattern: 'needle-binary' });
      expect(result.output).not.toContain('blob.bin:1');
    });

    test('lists files and counts in the other output modes', async () => {
      const files = await exec('grep', { pattern: 'needle-kept', output_mode: 'files' });
      expect(files.output.trim()).toBe('pkg/kept.txt');
      const counts = await exec('grep', { pattern: 'needle-kept', output_mode: 'count' });
      expect(counts.output.trim()).toBe('pkg/kept.txt:2');
    });

    test('reports a limit instead of stopping silently', async () => {
      const result = await exec('grep', { pattern: '^hay', limit: 5 });
      expect(result.output).toContain('[Search stopped early: the limit of 5 results was reached');
      expect(result.metadata?.incomplete).toBe(true);
    });

    test('restricts the search to a path', async () => {
      const result = await exec('grep', { pattern: 'needle', path: 'pkg' });
      expect(result.output).toContain('pkg/kept.txt');
      expect(result.output).not.toContain('many/');
    });

    test('a glob without a slash matches at any depth', async () => {
      const result = await exec('grep', { pattern: 'needle-kept', glob: '*.txt' });
      expect(result.output).toContain('pkg/kept.txt');
    });

    test('glob lists paths honoring the same ignore rules', async () => {
      const result = await exec('glob', { pattern: '**/*.txt', limit: 1000 });
      expect(result.output).toContain('pkg/kept.txt');
      expect(result.output).not.toContain('build/out.txt');
      expect(result.output).not.toContain('pkg/gen/code.txt');
      expect(result.metadata?.totalMatches).toBe(1001);
    });
  });
}

test('a pattern ripgrep cannot compile falls back to the JavaScript engine and says so', async () => {
  if (!findRipgrep()) return;
  const result = await createBuiltinRegistry().execute(
    'grep',
    { pattern: 'needle-(?=kept)' },
    { projectRoot, ignorePatterns: [], searchBackend: 'ripgrep' }
  );
  expect(result.output).toContain('pkg/kept.txt');
  expect(result.output).toContain('JavaScript regex engine');
});

test('glob can include directories', async () => {
  const result = await createBuiltinRegistry().execute(
    'glob',
    { pattern: 'pkg', include_dirs: true },
    { projectRoot, ignorePatterns: [] }
  );
  expect(result.output).toContain('pkg/');
});
