import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { auditConfiguration } from '../config.js';
import { projectEngine, projectKeyNames } from '../../../cli/audit.js';

let root: string;
let previousConfig: string | undefined;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-audit-')));
  fs.mkdirSync(path.join(root, '.jamcli'), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Rules\nBe careful.\n');
  previousConfig = process.env.JAMCLI_CONFIG_DIR;
  process.env.JAMCLI_CONFIG_DIR = path.join(root, '.user');
});
afterEach(() => {
  if (previousConfig === undefined) delete process.env.JAMCLI_CONFIG_DIR;
  else process.env.JAMCLI_CONFIG_DIR = previousConfig;
  fs.rmSync(root, { recursive: true, force: true });
});

const configure = (config: Record<string, unknown>, file = 'config.json') => fs.writeFileSync(path.join(root, '.jamcli', file), JSON.stringify(config));
const audit = (extra: Partial<Parameters<typeof auditConfiguration>[0]> = {}) => {
  const { engine, registry } = projectEngine(root, { PATH: process.env.PATH });
  return auditConfiguration({ projectRoot: root, cwd: root, engine, registry, ...extra });
};
const about = (report: ReturnType<typeof audit>, subject: string) => report.findings.find((finding) => finding.subject === subject);

test("a tool a configured rule allows is critical, named with the rule and its file, as the engine decides it", () => {
  configure({ permissions: { allow: ['run_command'] } });
  expect(about(audit(), 'run_command')).toMatchObject({ severity: 'critical', detail: 'allowed by run_command (.jamcli/config.json permissions.allow[0]), so it never asks' });
});

test("the mode's verdict is the one reported: asks by default, runs without asking under accept-edits, and bypass is critical", () => {
  expect(about(audit(), 'edit')).toMatchObject({ severity: 'medium', detail: 'asks first, which is the expected default: default mode asks before tools that change files' });
  configure({ permissions: { mode: 'accept-edits' } });
  expect(about(audit(), 'edit')).toMatchObject({ severity: 'medium', detail: 'runs without asking: accept-edits mode allows changes inside the project' });
  configure({ permissions: { deny: ['edit'] } });
  expect(about(audit(), 'edit')).toBeUndefined();
});

test('a rule that allows some calls of a tool is reported on its own, and one that allows every call is critical', () => {
  configure({ permissions: { allow: ['run_command(git status*)'] } });
  const report = audit();
  expect(about(report, 'run_command run_command(git status*)')).toMatchObject({ severity: 'medium', detail: 'allows the calls it names without asking (.jamcli/config.json permissions.allow[0])' });
  expect(about(report, 'run_command')?.severity).toBe('medium');
});

test('the legacy per-tool block is read as the engine reads it', () => {
  // `true` enables a tool with its own default, which for a command is to ask: the old table called it critical.
  configure({ tools: { run_command: true, apply_patch: { allowed: true, require_approval: false } } }, 'mcp.json');
  const report = audit();
  expect(about(report, 'run_command')).toMatchObject({ severity: 'medium', detail: expect.stringContaining('asks first') });
  expect(about(report, 'apply_patch')).toMatchObject({ severity: 'critical', detail: expect.stringContaining('.jamcli/mcp.json') });
});

test('a credential stored in a project file is reported without its value, each named with its file', () => {
  configure({ api_registry: { openai: { key_env_var: 'OPENAI_API_KEY' } } });
  configure({ api_registry: { anthropic: { api_key: 'sk-ant-local' } } }, 'config.local.json');
  const report = audit({ configKeyNames: projectKeyNames(root) });
  expect(report.findings.filter((finding) => finding.subject.endsWith('api_key')).map((finding) => finding.subject)).toEqual(['.jamcli/config.local.json api_registry.anthropic.api_key']);
  expect(about(report, '.jamcli/config.local.json api_registry.anthropic.api_key')?.detail).toContain('jamcli auth set');
  expect(JSON.stringify(report)).not.toContain('sk-ant-local');
});

test('an MCP server runs outside the sandbox, and one whose entry declares variables is told to take them from the environment', () => {
  const report = audit({ mcpServers: [{ id: 'files', command: 'npx', args: ['-y', 'server'], env: { TOKEN: 'x' } }] });
  expect(about(report, 'mcp:files')).toMatchObject({ criterion: 'isolation', severity: 'high', detail: "runs npx outside the sandbox, with JamCLI's environment less its credentials, plus what its entry declares" });
  expect(about(report, 'mcp:files.env')?.severity).toBe('high');
});

test('the audit writes nothing to the project', () => {
  const before = fs.readdirSync(root).sort();
  const beforeStat = fs.statSync(path.join(root, 'AGENTS.md')).mtimeMs;
  audit();
  expect(fs.readdirSync(root).sort()).toEqual(before);
  expect(fs.statSync(path.join(root, 'AGENTS.md')).mtimeMs).toBe(beforeStat);
});
