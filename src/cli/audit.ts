import fs from 'fs-extra';
import path from 'path';
import { auditConfiguration, renderAuditReport } from '../core/policy/audit.js';
import { resolveJamcliProjectRoot } from '../utils/projectRoot.js';
import { ConfigService } from '../services/ConfigService.js';
import type { McpServerConfig } from '../types/mcp.js';
import type { ToolPermissionValue } from '../types/config.js';

const readJsonIfPresent = (file: string): any | null => {
  try {
    if (!fs.existsSync(file)) return null;
    return fs.readJSONSync(file);
  } catch {
    return null;
  }
};

const collectKeyNames = (value: unknown, prefix = ''): string[] => {
  if (!value || typeof value !== 'object') return [];
  const names: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    names.push(next);
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      names.push(...collectKeyNames(nested, next));
    }
  }
  return names;
};

export const runAuditCli = async (): Promise<number> => {
  const projectRoot = resolveJamcliProjectRoot();
  const configService = new ConfigService(projectRoot);
  await configService.initialize();

  const permissions = (await configService.getToolPermissions()) as unknown as Record<string, ToolPermissionValue>;
  let mcpServers: McpServerConfig[] = [];
  try {
    mcpServers = await configService.listMcpServers();
  } catch {
    mcpServers = [];
  }

  const configPath = path.join(projectRoot, '.jamcli', 'config.json');
  const configJson = readJsonIfPresent(configPath);
  const configKeyNames = configJson ? collectKeyNames(configJson.api_registry ?? {}, 'api_registry') : [];

  const report = auditConfiguration({
    projectRoot,
    cwd: process.cwd(),
    permissions,
    mcpServers: mcpServers.map((server) => ({
      id: server.id,
      command: server.command,
      args: server.args,
      env: server.env,
    })),
    configKeyNames,
  });

  process.stdout.write(`${renderAuditReport(report)}\n`);
  return report.findings.some((finding) => finding.severity === 'critical') ? 1 : 0;
};
