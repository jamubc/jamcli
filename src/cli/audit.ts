import fs from 'fs';
import { readJsonSync } from '../utils/fsx.js';
import path from 'path';
import { auditConfiguration, renderAuditReport } from '../core/audit/config.js';
import { loadConfig, permissionLayers } from '../core/config/load.js';
import { sessionPermissions } from '../core/runtime/permissions.js';
import { detectSandbox } from '../core/sandbox/index.js';
import { createBuiltinRegistry } from '../core/tools/registry.js';
import { resolveJamcliProjectRoot } from '../utils/projectRoot.js';

const readJsonIfPresent = (file: string): any | null => {
  try {
    if (!fs.existsSync(file)) return null;
    return readJsonSync(file);
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

/** The registry keys in the project's configuration files, each named with its file. Values are never read out. */
export const projectKeyNames = (projectRoot: string): string[] =>
  ['config.json', 'config.local.json'].flatMap((name) => {
    const json = readJsonIfPresent(path.join(projectRoot, '.jamcli', name));
    return json ? collectKeyNames(json.api_registry ?? {}, 'api_registry').map((key) => `.jamcli/${name} ${key}`) : [];
  });

/** The engine the project's sessions decide with, in the configured mode, from every layer's rules. */
export function projectEngine(projectRoot: string, env: Record<string, string | undefined> = process.env) {
  const loaded = loadConfig({ projectRoot, env });
  const registry = createBuiltinRegistry();
  const sandbox = detectSandbox({ projectRoot, settings: loaded.config.sandbox ?? {} });
  const { engine } = sessionPermissions({
    projectRoot,
    registry,
    layers: permissionLayers(loaded),
    legacyTools: loaded.mcp.tools,
    sandboxed: sandbox.kind !== 'none',
    env,
    commitInBypass: loaded.config.git?.allow_commit_in_bypass === true,
  });
  return { engine, registry, mcpServers: loaded.mcp.servers ?? [] };
}

export const runAuditCli = async (): Promise<number> => {
  const projectRoot = resolveJamcliProjectRoot();
  const { engine, registry, mcpServers } = projectEngine(projectRoot);
  const configKeyNames = projectKeyNames(projectRoot);

  const report = auditConfiguration({
    projectRoot,
    cwd: process.cwd(),
    engine,
    registry,
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
