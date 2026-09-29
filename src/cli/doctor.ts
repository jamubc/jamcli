import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { loadConfig, type LoadedConfig } from '../core/config/load.js';
import { detectStore } from '../core/config/credentials.js';
import { createChatProvider } from '../core/providers/factory.js';
import { ProviderError } from '../core/providers/http.js';
import { resolveModel } from '../core/runtime/model.js';
import { loadAgents, type Agent } from '../core/ext/agents.js';
import { DEFAULT_LSP_SERVERS } from '../core/lsp/manager.js';
import { LspClient } from '../core/lsp/client.js';
import { detectSandbox } from '../core/sandbox/index.js';
import { exportTarget } from '../core/observe/otlp.js';
import { McpTestService } from '../services/McpTestService.js';
import { projectKeyNames } from './audit.js';
import { JAMCLI_VERSION } from '../core/version.js';

export type CheckStatus = 'ok' | 'info' | 'warn' | 'fail';

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it, for a warning or a failure. */
  fix?: string;
}

export interface DoctorOptions {
  projectRoot: string;
  /** Where executables are looked for and what child processes see. Defaults to the process environment. */
  env?: Record<string, string | undefined>;
  /** How long one network check may take. */
  timeoutMs?: number;
  /** Skip the checks that start MCP servers. */
  skipMcp?: boolean;
}

/** An executable on the PATH of `env`, or undefined. */
export function findExecutable(name: string, env: Record<string, string | undefined>): string | undefined {
  const names = process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const candidate of names.map((entry) => path.join(dir, entry))) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not here.
      }
    }
  }
  return undefined;
}

/** The first line a program prints for `--version`, or undefined when it will not run. */
const versionOf = (file: string, env: Record<string, string | undefined>): string | undefined => {
  const result = spawnSync(file, ['--version'], { encoding: 'utf8', timeout: 5_000, env: env as NodeJS.ProcessEnv });
  if (result.status !== 0) return undefined;
  return (result.stdout || result.stderr).trim().split('\n')[0];
};

function configurationChecks(settings: LoadedConfig, projectRoot: string, agentProblems: string[]): Check[] {
  const checks: Check[] = [];
  const files = settings.layers.filter((layer) => layer.scope !== 'default').map((layer) => layer.label);
  checks.push({ name: 'configuration', status: 'ok', detail: files.length ? `read ${files.join(', ')}` : 'no configuration files; defaults apply' });
  for (const error of settings.errors) {
    checks.push({ name: 'configuration', status: 'warn', detail: error, fix: 'Correct the value with jamcli config set, or edit the file.' });
  }
  for (const problem of agentProblems) {
    checks.push({ name: 'agents', status: 'warn', detail: problem, fix: 'Correct the agent file, or the delegation.default_agent setting.' });
  }
  for (const key of projectKeyNames(projectRoot).filter((name) => /(^|\.)api_key$/.test(name))) {
    const [file, setting] = key.split(' ');
    const provider = setting.split('.')[1];
    checks.push({
      name: 'keys',
      status: 'warn',
      detail: `${file} holds a key at ${setting}.`,
      fix: `Store it with jamcli auth set ${provider}, then remove it with jamcli config unset ${setting} --scope ${file.endsWith('local.json') ? 'local' : 'project'}.`,
    });
  }
  const dir = path.join(projectRoot, '.jamcli');
  if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, '.gitignore'))) {
    checks.push({
      name: 'project directory',
      status: 'warn',
      detail: '.jamcli/ has no .gitignore, so its history could be committed.',
      fix: 'JamCLI adds one the next time it stores something there; or create .jamcli/.gitignore containing *.',
    });
  }
  return checks;
}

function credentialCheck(env: Record<string, string | undefined>): Check {
  try {
    const store = detectStore(env);
    if (store.kind === 'file') {
      const file = store.where;
      if (fs.existsSync(file) && process.platform !== 'win32' && (fs.statSync(file).mode & 0o077) !== 0) {
        return { name: 'key store', status: 'fail', detail: `${file} can be read by others.`, fix: `chmod 600 ${file}` };
      }
      return { name: 'key store', status: 'ok', detail: `keys stored with jamcli auth go to ${file}, readable only by you` };
    }
    store.get('jamcli-doctor-probe');
    return { name: 'key store', status: 'ok', detail: `keys stored with jamcli auth go to ${store.where}` };
  } catch (error: any) {
    return { name: 'key store', status: 'fail', detail: error?.message ?? String(error), fix: 'Set JAMCLI_CREDENTIAL_STORE=file to keep keys in a file readable only by you.' };
  }
}

/** Every model a session may use: its own, and each configured agent's. */
function modelsInUse(settings: LoadedConfig, agents: Record<string, Agent>): { ref: string; role: string }[] {
  const { config, profile } = settings;
  const out: { ref: string; role: string }[] = [];
  const session = resolveModel(config.model, profile, config.api_registry);
  out.push({ ref: session.model ? `${session.provider}:${session.model}` : `${session.provider}:`, role: 'session model' });
  // An agent on the session's model has no chain, so the session model check covers it.
  for (const agent of Object.values(agents)) {
    for (const entry of agent.chain) out.push({ ref: entry.model, role: `agent ${agent.name}` });
  }
  const seen = new Map<string, string[]>();
  for (const entry of out) seen.set(entry.ref, [...(seen.get(entry.ref) ?? []), entry.role]);
  return [...seen].map(([ref, roles]) => ({ ref, role: roles.join(', ') }));
}

async function modelCheck(ref: string, role: string, settings: LoadedConfig, timeoutMs: number): Promise<Check> {
  const { config } = settings;
  const choice = resolveModel(ref, { name: 'doctor', preferred_provider: 'ollama' }, config.api_registry);
  const name = `model (${role})`;
  if (!choice.model) {
    return { name, status: 'fail', detail: `no model is chosen for ${choice.provider}.`, fix: `Run jamcli config set model ${choice.provider}:<model> --scope user, or /setup in the interface.` };
  }
  const label = `${choice.provider}:${choice.model}`;
  let provider;
  try {
    provider = createChatProvider(choice.provider, config.api_registry);
  } catch (error: any) {
    return { name, status: 'fail', detail: `${label}: ${error?.message ?? error}` };
  }
  if (!provider.describeModel) return { name, status: 'info', detail: `${label}: this provider cannot be asked about its models` };
  try {
    const facts = await provider.describeModel(choice.model, AbortSignal.timeout(timeoutMs));
    if (facts) {
      const window = facts.contextWindow ? `, a ${facts.contextWindow.toLocaleString('en-US')}-token window` : '';
      return { name, status: 'ok', detail: `${label} answers${window}` };
    }
    if (choice.provider === 'ollama') {
      return { name, status: 'fail', detail: `Ollama does not have ${choice.model}.`, fix: `ollama pull ${choice.model}` };
    }
    return { name, status: 'warn', detail: `${label}: the provider answered but does not list this model.`, fix: 'Check the model name with the provider.' };
  } catch (error: any) {
    const status = error instanceof ProviderError ? error.status : undefined;
    if (status === 401 || status === 403) {
      return { name, status: 'fail', detail: `${label}: the provider refused the key (${status}).`, fix: `Store a working key with jamcli auth set ${choice.provider}.` };
    }
    const reason = error?.name === 'TimeoutError' ? `no answer within ${Math.round(timeoutMs / 1000)} seconds` : error?.message ?? String(error);
    if (choice.provider === 'ollama') {
      const endpoint = config.api_registry.ollama?.base_url || config.api_registry.ollama?.endpoint || 'http://localhost:11434';
      return { name, status: 'fail', detail: `Ollama is not answering at ${endpoint}: ${reason}.`, fix: 'Start it with ollama serve, or set api_registry.ollama.endpoint.' };
    }
    return { name, status: 'fail', detail: `${label}: ${reason}.`, fix: 'Check the network and api_registry for this provider.' };
  }
}

function toolChecks(projectRoot: string, settings: LoadedConfig, env: Record<string, string | undefined>): Check[] {
  const checks: Check[] = [];
  const rg = findExecutable('rg', env);
  checks.push(
    rg
      ? { name: 'ripgrep', status: 'ok', detail: versionOf(rg, env) ?? rg }
      : { name: 'ripgrep', status: 'warn', detail: 'not found, so search uses a slower built-in walk.', fix: 'Install ripgrep (rg).' }
  );
  const sandbox = detectSandbox({ projectRoot, settings: settings.config.sandbox, env: env as NodeJS.ProcessEnv });
  checks.push(
    sandbox.kind === 'none'
      ? {
          name: 'sandbox',
          status: 'warn',
          detail: `none: ${sandbox.reason}. Commands run unsandboxed, and auto mode is unavailable.`,
          fix: process.platform === 'linux' ? 'Install bubblewrap (bwrap), and allow unprivileged user namespaces.' : 'Commands ask before they run.',
        }
      : { name: 'sandbox', status: 'ok', detail: `${sandbox.kind}: ${sandbox.reason}` }
  );
  const git = findExecutable('git', env);
  if (!git) checks.push({ name: 'git', status: 'warn', detail: 'not found.', fix: 'Install git; history, diffs, and commits need it.' });
  else {
    const inside = spawnSync(git, ['rev-parse', '--show-toplevel'], { cwd: projectRoot, encoding: 'utf8', timeout: 5_000, env: env as NodeJS.ProcessEnv });
    checks.push({ name: 'git', status: 'ok', detail: `${versionOf(git, env) ?? git}${inside.status === 0 ? `; this project is a repository` : '; this project is not a repository'}` });
  }
  const gh = findExecutable('gh', env);
  checks.push(
    gh
      ? { name: 'gh', status: 'ok', detail: versionOf(gh, env) ?? gh }
      : { name: 'gh', status: 'info', detail: 'not found; needed only to open pull requests.', fix: 'Install the GitHub CLI (gh) to open pull requests from JamCLI.' }
  );
  return checks;
}

/** Every configured, installed language server, and whether it starts, like mcpChecks does for MCP servers. */
async function lspChecks(projectRoot: string, settings: LoadedConfig, env: Record<string, string | undefined>, timeoutMs: number): Promise<Check[]> {
  const lsp = settings.config.lsp;
  if (lsp?.enabled === false) return [{ name: 'language servers', status: 'info', detail: 'off (lsp.enabled is false)' }];
  const merged = { ...DEFAULT_LSP_SERVERS, ...(lsp?.servers ?? {}) };
  const configured = Object.entries(merged).filter(([, server]) => server.enabled !== false && findExecutable(server.command, env));
  if (configured.length === 0) return [{ name: 'language servers', status: 'info', detail: 'none installed' }];
  return Promise.all(
    configured.map(async ([name, server]): Promise<Check> => {
      try {
        const client = await LspClient.start({ command: server.command, args: server.args, env }, projectRoot, timeoutMs);
        await client.stop().catch(() => undefined);
        return { name: `language server ${name}`, status: 'ok', detail: `${server.command} starts` };
      } catch (error: any) {
        return { name: `language server ${name}`, status: 'fail', detail: error?.message ?? String(error), fix: `Check that ${server.command} runs on its own.` };
      }
    })
  );
}

async function mcpChecks(projectRoot: string, settings: LoadedConfig): Promise<Check[]> {
  const servers = (settings.mcp.servers ?? []).filter((server) => server.enabled !== false);
  const tester = new McpTestService();
  return Promise.all(
    servers.map(async (server): Promise<Check> => {
      const result = await tester.testServer(server as any, projectRoot);
      return result.status === 'ok'
        ? { name: `MCP ${server.id}`, status: 'ok', detail: result.message }
        : { name: `MCP ${server.id}`, status: 'fail', detail: result.message, fix: `Check the entry in .jamcli/mcp.json, then run jamcli mcp test ${server.id}.` };
    })
  );
}

async function telemetryCheck(settings: LoadedConfig, env: Record<string, string | undefined>, timeoutMs: number): Promise<Check> {
  const otel = settings.config.otel;
  if (!otel?.enabled) return { name: 'telemetry', status: 'ok', detail: 'off; nothing is sent anywhere' };
  const target = exportTarget(otel, env);
  try {
    const response = await fetch(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...target.headers },
      body: JSON.stringify({ resourceSpans: [] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`the collector answered ${response.status}`);
    return { name: 'telemetry', status: 'ok', detail: `traces go to ${target.url}${otel.include_content ? ', with content' : ''}` };
  } catch (error: any) {
    return { name: 'telemetry', status: 'fail', detail: `the collector at ${target.url} cannot be reached: ${error?.message ?? error}`, fix: 'Start the collector, or set otel.endpoint.' };
  }
}

/** Every check, in the order they are shown. None of them changes anything. */
export async function runChecks(options: DoctorOptions): Promise<Check[]> {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const settings = loadConfig({ projectRoot: options.projectRoot, env });
  const agents = loadAgents(options.projectRoot, settings.config);
  const [models, mcp, lsp, telemetry] = await Promise.all([
    Promise.all(modelsInUse(settings, agents.agents).map((entry) => modelCheck(entry.ref, entry.role, settings, timeoutMs))),
    options.skipMcp ? Promise.resolve([]) : mcpChecks(options.projectRoot, settings),
    lspChecks(options.projectRoot, settings, env, timeoutMs),
    telemetryCheck(settings, env, timeoutMs),
  ]);
  return [
    ...configurationChecks(settings, options.projectRoot, agents.problems),
    credentialCheck(env),
    ...models,
    ...toolChecks(options.projectRoot, settings, env),
    ...mcp,
    ...lsp,
    telemetry,
  ];
}

/** The checks as text: a status word, the check, what was found, and the fix on its own line. */
export function renderChecks(checks: Check[], projectRoot: string): string {
  const width = Math.max(...checks.map((check) => check.name.length));
  const engine = process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`;
  const lines = [`JamCLI ${JAMCLI_VERSION} on ${process.platform}, ${engine}, in ${projectRoot}`, ''];
  for (const check of checks) {
    lines.push(`${check.status.padEnd(4)}  ${check.name.padEnd(width)}  ${check.detail}`);
    if (check.fix && (check.status === 'warn' || check.status === 'fail')) lines.push(`${' '.repeat(width + 8)}fix: ${check.fix}`);
  }
  const failed = checks.filter((check) => check.status === 'fail').length;
  const warned = checks.filter((check) => check.status === 'warn').length;
  lines.push('', failed || warned ? `${failed} problem${failed === 1 ? '' : 's'}, ${warned} warning${warned === 1 ? '' : 's'}.` : 'Everything checked is working.');
  return lines.join('\n');
}

export async function runDoctorCommand(args: string[], projectRoot: string, io = { out: (text: string) => process.stdout.write(`${text}\n`) }): Promise<number> {
  const checks = await runChecks({ projectRoot, skipMcp: args.includes('--no-mcp') });
  io.out(args.includes('--json') ? JSON.stringify(checks, null, 2) : renderChecks(checks, projectRoot));
  return checks.some((check) => check.status === 'fail') ? 1 : 0;
}
