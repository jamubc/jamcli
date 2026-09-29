import fs from 'fs';
import path from 'path';
import type { PermissionEngine } from '../permissions/engine.js';
import { toolMatches } from '../permissions/rules.js';
import { loadRules } from '../rules/index.js';
import type { ToolRegistry } from '../tools/registry.js';
import { toolNaming } from '../runtime/tools.js';

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface AuditFinding {
  criterion: 'dangerous_tool_access' | 'isolation' | 'prompt_injection_surface' | 'missing_guardrails' | 'trigger_breadth';
  severity: AuditSeverity;
  subject: string;
  detail: string;
}

export interface AuditInput {
  projectRoot: string;
  cwd?: string;
  /** The engine the project's sessions decide with: the configured mode and every layer's rules. */
  engine: PermissionEngine;
  /** The tools that engine decides. */
  registry: ToolRegistry;
  mcpServers?: { id: string; command: string; args?: string[]; env?: Record<string, string> }[];
  configKeyNames?: string[];
}

export interface AuditReport {
  findings: AuditFinding[];
  scanned: string[];
}

const ORDER: Record<AuditSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
/** Classes whose calls change nothing outside the session: reading, and keeping the plan. */
const HARMLESS = new Set(['read', 'state']);

/**
 * What each tool that changes something may do, as the engine decides it: a call it allows
 * outright, by a rule or by the mode, and each rule that allows some of its calls, since
 * a tool judged by its arguments, such as a command, has no single verdict.
 */
function toolFindings(engine: PermissionEngine, registry: ToolRegistry): AuditFinding[] {
  const { namesOf } = toolNaming(registry);
  const findings: AuditFinding[] = [];
  for (const tool of registry.visible()) {
    if (tool.aliasOf || HARMLESS.has(tool.policy) || !engine.offers(tool.name)) continue;
    const names = namesOf(tool.name);
    const verdict = engine.decide({ id: 'audit', name: tool.name, arguments: {} });
    if (verdict.decision === 'allow') {
      const bypass = engine.mode === 'bypass';
      findings.push({
        criterion: 'dangerous_tool_access',
        severity: verdict.rule || bypass ? 'critical' : 'medium',
        subject: tool.name,
        detail: verdict.rule ? `allowed by ${verdict.rule} (${verdict.source}), so it never asks` : `runs without asking: ${verdict.reason}`,
      });
    } else if (verdict.decision === 'ask') {
      findings.push({ criterion: 'dangerous_tool_access', severity: 'medium', subject: tool.name, detail: `asks first, which is the expected default: ${verdict.reason}` });
    }
    for (const rule of engine.list()) {
      if (rule.decision !== 'allow' || !rule.pattern || rule.scope === 'builtin' || !toolMatches(rule, names)) continue;
      const every = /^\*+$/.test(rule.pattern.trim());
      findings.push({
        criterion: 'dangerous_tool_access',
        severity: every ? 'critical' : 'medium',
        subject: `${tool.name} ${rule.text}`,
        detail: every ? `allows every call without asking (${rule.source})` : `allows the calls it names without asking (${rule.source})`,
      });
    }
  }
  return findings;
}

export const auditConfiguration = (input: AuditInput): AuditReport => {
  const findings: AuditFinding[] = toolFindings(input.engine, input.registry);
  const scanned: string[] = [];

  for (const server of input.mcpServers ?? []) {
    findings.push({
      criterion: 'isolation',
      severity: 'high',
      subject: `mcp:${server.id}`,
      detail: `runs ${server.command} outside the sandbox, with JamCLI's environment less its credentials, plus what its entry declares`,
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
