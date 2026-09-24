import { test, expect } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { auditConfiguration, renderAuditReport, summarizeBySeverity } from '../audit.js';
import { projectKeyNames } from '../../../cli/audit.js';

const makeProject = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-audit-'));
  fs.mkdirpSync(path.join(root, '.jamcli'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Rules\nBe careful.\n');
  return root;
};

test('a state-changing tool that never asks is critical', () => {
  const report = auditConfiguration({
    projectRoot: makeProject(),
    permissions: { apply_patch: { allowed: true, require_approval: false } },
  });
  const finding = report.findings.find((item) => item.subject === 'apply_patch');
  expect(finding?.severity).toBe('critical');
  expect(finding?.criterion).toBe('dangerous_tool_access');
});

test('a boolean shorthand on a state-changing tool is critical', () => {
  const report = auditConfiguration({
    projectRoot: makeProject(),
    permissions: { run_command: true },
  });
  expect(report.findings.some((item) => item.subject === 'run_command' && item.severity === 'critical')).toBe(true);
});

test('the default ask posture is reported but only at medium', () => {
  const report = auditConfiguration({ projectRoot: makeProject(), permissions: {} });
  const applyPatch = report.findings.find((item) => item.subject === 'apply_patch');
  expect(applyPatch?.severity).toBe('medium');
});

test('a credential stored in the project file is reported without its value', () => {
  const report = auditConfiguration({
    projectRoot: makeProject(),
    configKeyNames: ['api_registry.openrouter.api_key', 'active_profile'],
  });
  const finding = report.findings.find((item) => item.subject.endsWith('api_key'));
  expect(finding?.severity).toBe('high');
  expect(finding?.detail).toContain('jamcli auth set');
  expect(JSON.stringify(report)).not.toContain('sk-');
});

test('keys in the project-local file are found too, each named with its file', () => {
  const root = makeProject();
  fs.mkdirSync(path.join(root, '.jamcli'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { openai: { key_env_var: 'OPENAI_API_KEY' } } }));
  fs.writeFileSync(path.join(root, '.jamcli', 'config.local.json'), JSON.stringify({ api_registry: { anthropic: { api_key: 'sk-ant-local' } } }));
  const report = auditConfiguration({ projectRoot: root, configKeyNames: projectKeyNames(root) });
  expect(report.findings.filter((item) => item.subject.endsWith('api_key')).map((item) => item.subject)).toEqual([
    '.jamcli/config.local.json api_registry.anthropic.api_key',
  ]);
  expect(JSON.stringify(report)).not.toContain('sk-ant-local');
});

test('an MCP server that inherits the environment is a high isolation finding', () => {
  const report = auditConfiguration({
    projectRoot: makeProject(),
    mcpServers: [{ id: 'files', command: 'npx', args: ['-y', 'server'], env: { TOKEN: 'x' } }],
  });
  expect(report.findings.some((item) => item.criterion === 'isolation' && item.severity === 'high')).toBe(true);
  expect(report.findings.some((item) => item.subject === 'mcp:files.env')).toBe(true);
});

test('the audit writes nothing to the project', () => {
  const root = makeProject();
  const before = fs.readdirSync(root).sort();
  const beforeStat = fs.statSync(path.join(root, 'AGENTS.md')).mtimeMs;
  auditConfiguration({ projectRoot: root, permissions: {} });
  const after = fs.readdirSync(root).sort();
  expect(after).toEqual(before);
  expect(fs.statSync(path.join(root, 'AGENTS.md')).mtimeMs).toBe(beforeStat);
});

test('the report renders severity first and names what was scanned', () => {
  const report = auditConfiguration({ projectRoot: makeProject(), permissions: { run_command: true } });
  const text = renderAuditReport(report);
  expect(text.split('\n')[0]).toBe('JamCLI audit');
  expect(text).toContain('[critical] dangerous_tool_access run_command');
  expect(text).toContain('Scanned');
});

test('the severity summary counts every finding', () => {
  const report = auditConfiguration({ projectRoot: makeProject(), permissions: { run_command: true } });
  const summary = summarizeBySeverity(report.findings);
  expect(summary.critical).toBeGreaterThan(0);
  expect(summary.critical + summary.high + summary.medium + summary.low).toBe(report.findings.length);
});
