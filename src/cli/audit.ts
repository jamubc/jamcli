import fs from 'fs';
import { execFileSync } from 'child_process';
import { readJsonSync } from '../utils/fsx.js';
import path from 'path';
import { auditConfiguration, renderAuditReport } from '../core/audit/config.js';
import { ledgerOf, renderLedger, type LedgerEntry } from '../core/audit/ledger.js';
import { historyDirFor, readTranscript } from '../core/transcript/index.js';
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

/** The files a checkpointed step changed, as git compares the tree before it with the one it left. */
const gitChanged = (cwd: string) => (ref: string, after: string): string[] => {
  try {
    return execFileSync('git', ['diff', '--name-only', ref, after], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

/**
 * Every decision the project's sessions recorded: each call that changed something or was
 * refused, who decided, under which rule and from which source, and the files it changed.
 */
export function projectLedger(projectRoot: string, filter: { session?: string; since?: number; refused?: boolean } = {}): LedgerEntry[] {
  const dir = historyDirFor(projectRoot);
  if (!fs.existsSync(dir)) return [];
  const entries: LedgerEntry[] = [];
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.jsonl')).sort()) {
    const events = readTranscript(path.join(dir, name));
    const header = events.find((event) => event.type === 'session') as { id: string; ts: number; cwd?: string } | undefined;
    if (!header || (filter.session && header.id !== filter.session) || (filter.since !== undefined && header.ts < filter.since)) continue;
    entries.push(...ledgerOf(events, { changedBetween: gitChanged(header.cwd ?? projectRoot) }).filter((entry) => !filter.refused || !entry.allowed));
  }
  return entries;
}

const LEDGER_USAGE = 'Usage: jamcli audit ledger [--session <id>] [--since <yyyy-mm-dd>] [--refused] [--json]';

function runLedger(args: string[], projectRoot: string): number {
  const filter: { session?: string; since?: number; refused?: boolean } = {};
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--json') json = true;
    else if (arg === '--refused') filter.refused = true;
    else if ((arg === '--session' || arg === '--since') && args[i + 1]) {
      const value = args[(i += 1)]!;
      if (arg === '--session') filter.session = value;
      else if (Number.isNaN(Date.parse(value))) {
        process.stderr.write(`${value} is not a date. ${LEDGER_USAGE}\n`);
        return 1;
      } else filter.since = Date.parse(value);
    } else {
      process.stderr.write(`${arg} is not an option of jamcli audit ledger. ${LEDGER_USAGE}\n`);
      return 1;
    }
  }
  const entries = projectLedger(projectRoot, filter);
  process.stdout.write(json ? `${JSON.stringify(entries, null, 2)}\n` : `${renderLedger(entries)}\n`);
  return 0;
}

export const runAuditCli = async (args: string[] = [], projectRoot: string = resolveJamcliProjectRoot()): Promise<number> => {
  if (args[0] === 'ledger') return runLedger(args.slice(1), projectRoot);
  if (args.length) {
    process.stderr.write(`jamcli audit takes no ${args[0]}. Run jamcli audit for the configuration report, or jamcli audit ledger for the decisions.\n`);
    return 1;
  }
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
