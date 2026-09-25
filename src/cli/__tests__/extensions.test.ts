import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runHooksCommand, runSkillCommand } from '../extensions.js';
import { parseArgs } from '../../cli.js';

const ENTRY = path.join(import.meta.dir, '../../index.tsx');

let base: string;
let root: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-cli-ext-')));
  root = path.join(base, 'project');
  fs.mkdirSync(path.join(root, '.jamcli'), { recursive: true });
  saved = { JAMCLI_CONFIG_DIR: process.env.JAMCLI_CONFIG_DIR, JAMCLI_STATE_DIR: process.env.JAMCLI_STATE_DIR };
  process.env.JAMCLI_CONFIG_DIR = path.join(base, 'user');
  process.env.JAMCLI_STATE_DIR = path.join(base, 'state');
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(base, { recursive: true, force: true });
});

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) }, out, err };
};

test('jamcli skill list names each skill with its source, and what could not be read', async () => {
  const empty = capture();
  expect(await runSkillCommand(['list'], root, empty.io)).toBe(0);
  expect(empty.out.join('\n')).toContain('No skills. A skill is a directory holding SKILL.md, found in:\n  .jamcli/skills (project)\n  .agents/skills (project)');

  fs.mkdirSync(path.join(root, '.agents', 'skills', 'review'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Review a change.\nallowed-tools: Read\n---\nbody\n');
  fs.mkdirSync(path.join(root, '.agents', 'skills', 'Broken'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'skills', 'Broken', 'SKILL.md'), '---\nname: Broken\ndescription: x\n---\n');
  const listed = capture();
  expect(await runSkillCommand([], root, listed.io)).toBe(0);
  const text = listed.out.join('\n');
  expect(text).toContain('Skills (1), which the model loads with the skill tool when a task calls for one:\n  review (project): Review a change.\n    .agents/skills/review; while active, only read_file');
  expect(text).toContain('Not loaded: ');
  expect(text).toContain('Broken/SKILL.md');

  const wrong = capture();
  expect(await runSkillCommand(['remove'], root, wrong.io)).toBe(2);
  expect(wrong.err).toEqual(['Usage: jamcli skill list']);
});

test('jamcli hooks lists the hooks and whether they run, and trust records the project\'s as they are', async () => {
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ hooks: { pre_tool: [{ matcher: 'run_command(git push*)', command: './guard.sh', timeout_ms: 5000 }] } }));
  const before = capture();
  expect(await runHooksCommand([], root, before.io)).toBe(0);
  expect(before.out.join('\n')).toBe(
    [
      'Hooks (1):',
      '  pre_tool run_command(git push*): ./guard.sh',
      '    .jamcli/config.json; not trusted, so not run; stopped after 5000 ms',
      '',
      'This project\'s hooks run once you trust them: /hooks trust, or jamcli hooks trust. Trust lapses when they change.',
    ].join('\n')
  );
  const trusted = capture();
  expect(await runHooksCommand(['trust'], root, trusted.io)).toBe(0);
  expect(trusted.out).toEqual(['Trusted this project\'s 1 hook(s) as they are now. They run from the next session.']);
  const after = capture();
  await runHooksCommand(['list'], root, after.io);
  expect(after.out.join('\n')).toContain('.jamcli/config.json; runs; stopped after 5000 ms');
  expect(after.out.join('\n')).not.toContain('trust them');
  // The trust is kept outside the project, where a repository cannot plant it.
  expect(fs.existsSync(path.join(base, 'state', 'trusted-hooks.json'))).toBe(true);
  expect(fs.readdirSync(path.join(root, '.jamcli'))).toEqual(['config.json']);
});

test('the command line reaches skill and hooks, with --cwd anywhere', async () => {
  expect(parseArgs(['skill', 'list', '--cwd', '/x'])).toMatchObject({ skillCommand: ['list'], cwd: '/x' });
  expect(parseArgs(['--cwd', '/y', 'hooks', 'trust'])).toMatchObject({ hooksCommand: ['trust'], cwd: '/y' });
  const child = Bun.spawn(['bun', ENTRY, 'hooks', '--cwd', root], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env } });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(code).toBe(0);
  expect(out).toStartWith('No hooks.');
});
