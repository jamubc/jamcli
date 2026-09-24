import fs from 'fs';
import path from 'path';
import { listTools } from '../tools/registry.js';
import { resolveToolPolicy } from './index.js';
import { loadRules } from '../rules/index.js';
import type { ToolPermissionValue } from '../../types/config.js';

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface AuditFinding {
  criterion:
    | 'dangerous_tool_access'
    | 'isolation'
    | 'prompt_injection_surface'
    | 'missing_guardrails'
    | 'trigger_breadth';
  severity: AuditSeverity;
  subject: string;
  detail: string;
}

export interface AuditInput {
  projectRoot: string;
  cwd?: string;
  permissions?: Record<string, ToolPermissionValue>;
  mcpServers?: { id: string; command: string; args?: string[]; env?: Record<string, string> }[];
  configKeyNames?: string[];
}

export interface AuditReport {
  findings: AuditFinding[];
  scanned: string[];
}

const ORDER: Record<AuditSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const isStateChanging = (tool: string) => {
  const entry = listTools().find((item) => item.name === tool);
  return entry ? entry.policy !== 'read' : true;
};

export const auditConfiguration = (input: AuditInput): AuditReport => {
  const findings: AuditFinding[] = [];
  const scanned: string[] = [];

  const permissions = input.permissions ?? {};
  for (const tool of listTools()) {
    const permission = permissions[tool.name];
    const policy = resolveToolPolicy(tool.name, { permissions });

    if (policy.decision === 'deny') continue;
    if (!isStateChanging(tool.name)) continue;

    if (typeof permission === 'boolean' && permission) {
      findings.push({
        criterion: 'dangerous_tool_access',
        severity: 'critical',
        subject: tool.name,
        detail: 'enabled with a boolean shorthand so it never asks for approval',
      });
      continue;
    }

    if (typeof permission === 'object' && permission.allowed && !permission.require_approval) {
      findings.push({
        criterion: 'dangerous_tool_access',
        severity: 'critical',
        subject: tool.name,
        detail: 'state-changing tool runs without approval',
      });
      continue;
    }

    if (policy.decision === 'ask') {
      findings.push({
        criterion: 'dangerous_tool_access',
        severity: 'medium',
        subject: tool.name,
        detail: 'state-changing tool asks for approval, which is the expected default',
      });
    }
  }

  for (const server of input.mcpServers ?? []) {
    findings.push({
      criterion: 'isolation',
      severity: 'high',
      subject: `mcp:${server.id}`,
      detail: `spawns ${server.command} with the full process environment inherited`,
    });
    if (server.env && Object.keys(server.env).length) {
      findings.push({
        criterion: 'missing_guardrails',
        severity: 'high',
        subject: `mcp:${server.id}.env`,
        detail: `declares ${Object.keys(server.env).join(', ')} in the project file; prefer the environment of the parent process`,
      });
    }
  }

  const rules = loadRules(input.projectRoot, input.cwd ?? process.cwd());
  scanned.push(...rules.files.map((file) => file.path));

  const rulesDir = path.join(input.projectRoot, '.jamcli', 'rules');
  if (fs.existsSync(rulesDir)) scanned.push(rulesDir);

  if (!rules.files.length) {
    findings.push({
      criterion: 'prompt_injection_surface',
      severity: 'low',
      subject: 'instruction files',
      detail: 'no instruction file is loaded, so there is nothing to review',
    });
  }

  for (const file of rules.files) {
    if (!file.sections.some((section) => section.condition)) continue;
    findings.push({
      criterion: 'trigger_breadth',
      severity: 'low',
      subject: file.displayPath,
      detail: 'declares glob conditions; sections outside a condition always apply',
    });
  }

  for (const key of input.configKeyNames ?? []) {
    if (/(^|\.)api_key$/.test(key)) {
      findings.push({
        criterion: 'missing_guardrails',
        severity: 'high',
        subject: key,
        detail: 'a credential is stored in a project file; name its variable in key_env_var, or store it with jamcli auth set <provider>',
      });
    }
  }

  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.subject.localeCompare(b.subject));

  return { findings, scanned };
};

export const renderAuditReport = (report: AuditReport): string => {
  const lines: string[] = ['JamCLI audit', ''];
  if (!report.findings.length) {
    lines.push('No findings.');
  } else {
    for (const finding of report.findings) {
      lines.push(`[${finding.severity}] ${finding.criterion} ${finding.subject}: ${finding.detail}`);
    }
  }
  lines.push('', `Scanned ${report.scanned.length} file${report.scanned.length === 1 ? '' : 's'}.`);
  return lines.join('\n');
};

export const summarizeBySeverity = (findings: AuditFinding[]): Record<AuditSeverity, number> => {
  const summary: Record<AuditSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) summary[finding.severity] += 1;
  return summary;
};
