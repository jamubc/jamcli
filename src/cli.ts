import { runHeadless, type HeadlessResult } from './cli/run.js';
import { runAuditCli } from './cli/audit.js';
import { runMcpCommand } from './cli/mcp.js';
import { CONFIG_ACTIONS, CONFIG_USAGE, runConfigCommand, type ConfigAction } from './cli/config.js';
import { AUTH_ACTIONS, AUTH_USAGE, runAuthCommand, type AuthAction } from './cli/auth.js';
import {
  exportSession,
  forkSession,
  latestSessionId,
  listSessions,
  loadSessionMessages,
  renderSession,
  searchSessions,
} from './core/session/store.js';
import { resolveJamcliProjectRoot } from './utils/projectRoot.js';
import type { AgentEvent } from './core/types.js';
import { JAMCLI_VERSION } from './core/version.js';
import type { SpendSummary } from './core/catalog/cost.js';

const SESSIONS_ACTIONS = ['list', 'search', 'show', 'export', 'fork'] as const;
type SessionsAction = (typeof SESSIONS_ACTIONS)[number];

export type McpAction = 'add' | 'list' | 'test' | 'remove';

export interface ParsedArgs {
  prompt?: string;
  outputFormat: 'text' | 'json' | 'stream-json';
  cwd?: string;
  maxTurns?: number;
  model?: string;
  resume?: string;
  continueLast: boolean;
  allowTools: string[];
  denyTools: string[];
  allowedTools: string[];
  disallowedTools: string[];
  permissionMode?: string;
  bypassPermissions: boolean;
  dryRun: boolean;
  /** `-v` once for info, `-vv` or twice for debug. */
  verbosity: number;
  logFile?: string;
  traceFile?: string;
  sessionsCommand?: { action: SessionsAction; query?: string };
  mcpCommand?: { action: McpAction; args: string[] };
  /** `jamcli config`, with no action or an unknown one left undefined so usage is shown. */
  configCommand?: { action?: ConfigAction; args: string[] };
  /** `jamcli auth`, likewise. */
  authCommand?: { action?: AuthAction; args: string[] };
  audit: boolean;
  /** `jamcli doctor`, with its own arguments. */
  doctor?: string[];
  acp: boolean;
  help: boolean;
  version: boolean;
  unknown: string[];
}

export const parseArgs = (argv: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {
    outputFormat: 'text',
    continueLast: false,
    allowTools: [],
    denyTools: [],
    allowedTools: [],
    disallowedTools: [],
    bypassPermissions: false,
    dryRun: false,
    verbosity: 0,
    help: false,
    version: false,
    audit: false,
    acp: false,
    unknown: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '-p' || token === '--prompt') {
      parsed.prompt = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--output-format') {
      const value = argv[i + 1];
      if (value === 'json' || value === 'stream-json' || value === 'text') parsed.outputFormat = value;
      i += 1;
      continue;
    }
    if (token === '--cwd') {
      parsed.cwd = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--max-turns') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) parsed.maxTurns = Math.floor(value);
      i += 1;
      continue;
    }
    if (token === '--model') {
      parsed.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--resume') {
      parsed.resume = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--continue') {
      parsed.continueLast = true;
      continue;
    }
    if (token === '--allow-tool') {
      parsed.allowTools.push(argv[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (token === '--allowed-tools') {
      parsed.allowedTools.push(argv[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (token === '--disallowed-tools') {
      parsed.disallowedTools.push(argv[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (token === '--permission-mode') {
      parsed.permissionMode = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--dangerously-bypass-permissions') {
      parsed.bypassPermissions = true;
      continue;
    }
    if (token === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (token === '--deny-tool') {
      parsed.denyTools.push(argv[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      parsed.help = true;
      continue;
    }
    if (token === '--version' || (token === '-v' && argv.length === 1)) {
      parsed.version = true;
      continue;
    }
    if (token === '-v' || token === '--verbose') {
      parsed.verbosity += 1;
      continue;
    }
    if (token === '-vv') {
      parsed.verbosity += 2;
      continue;
    }
    if (token === '--log-file' || token === '--trace-file') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) parsed.unknown.push(`${token} needs a path`);
      else if (token === '--log-file') parsed.logFile = value;
      else parsed.traceFile = value;
      i += 1;
      continue;
    }
    if (token === 'audit') {
      parsed.audit = true;
      continue;
    }
    if (token === 'doctor') {
      parsed.doctor = argv.slice(i + 1);
      return parsed;
    }
    if (token === 'sessions') {
      const action = argv[i + 1];
      if (SESSIONS_ACTIONS.includes(action as SessionsAction)) {
        parsed.sessionsCommand = { action: action as SessionsAction, query: argv[i + 2] };
        i += 2;
      }
      continue;
    }
    if (token === 'mcp') {
      const action = argv[i + 1];
      const args = argv.slice(i + 2);
      if (action === 'add' || action === 'list' || action === 'test' || action === 'remove') {
        parsed.mcpCommand = { action, args };
      } else {
        parsed.mcpCommand = { action: (action ?? 'list') as McpAction, args };
      }
      return parsed;
    }
    if (token === 'config') {
      const action = argv[i + 1];
      parsed.configCommand = {
        action: CONFIG_ACTIONS.includes(action as ConfigAction) ? (action as ConfigAction) : undefined,
        args: argv.slice(i + 2),
      };
      return parsed;
    }
    if (token === 'auth') {
      const action = argv[i + 1];
      parsed.authCommand = {
        action: AUTH_ACTIONS.includes(action as AuthAction) ? (action as AuthAction) : undefined,
        args: argv.slice(i + 2),
      };
      return parsed;
    }
    if (token === 'acp') {
      parsed.acp = true;
      continue;
    }
    if (token.startsWith('-')) {
      parsed.unknown.push(token);
      continue;
    }
    if (!parsed.prompt) {
      parsed.prompt = token;
    }
  }

  return parsed;
};

export const USAGE = `Usage: jamcli [options]

  -p, --prompt <text>          Run one prompt without the interface
      --output-format <fmt>    text (default), json, or stream-json
      --cwd <path>             Run in this directory
      --max-turns <n>          Bound the number of turns
      --model <id>             Run this turn on a specific model
      --resume <session-id>    Continue an existing session
      --continue               Continue the most recent session
      --allow-tool <name>      Allow a tool for this run (repeatable)
      --deny-tool <name>       Deny a tool for this run (repeatable)
      --allowed-tools <rules>  Allow rules such as "edit(src/**),run_command(npm test *)"
      --disallowed-tools <rules>  Deny rules in the same syntax; a deny always wins
      --permission-mode <mode> plan, default, accept-edits, auto, or bypass
      --dangerously-bypass-permissions  Run in bypass mode: nothing asks, only denies stop
      --dry-run                Make no change; report each call that would have made one
  -v, -vv, --verbose           Log more: -v adds each request and tool call, -vv prompts and outputs too
      --log-file <path>        Write the log here instead of the state directory's logs/
      --trace-file <path>      Write each span (session, turn, model request, tool call) as JSON lines

  jamcli sessions list|search <query>|show <id>|export <id>|fork <id>
  jamcli audit                 Report tool access, isolation, and guardrail findings
  jamcli doctor [--json] [--no-mcp]   Check providers, models, tools, the sandbox, and configuration
  jamcli config list|get|set|unset|migrate   Read and change configuration, layer by layer
  jamcli auth set|get|remove|list|login   Store provider keys in the keychain, or sign in to OpenRouter
  jamcli mcp add|list|test|remove   Manage MCP servers in .jamcli/mcp.json
  jamcli acp                   Serve the Agent Client Protocol over stdio

  --help                       Show this help
  --version, -v                Show the version (-v alone)`;

const serializeUsage = (usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) =>
  usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

/** Dollars where some request had a price, and null where none did, so unknown never reads as free. */
const pricedOrNull = (cost: number, requests: number, unpriced: number) => (requests > 0 && unpriced === requests ? null : cost);

/** The session's spend in JSON. While `unpriced_requests` is above zero, a cost is a lower bound. */
const serializeSpend = (spend: SpendSummary): Record<string, unknown> => ({
  total_cost_usd: pricedOrNull(spend.cost, spend.requests, spend.unpriced),
  unpriced_requests: spend.unpriced,
  model_usage: Object.fromEntries(
    spend.models.map((model) => [
      model.model,
      {
        requests: model.requests,
        cost_usd: pricedOrNull(model.cost, model.requests, model.unpriced),
        unpriced_requests: model.unpriced,
        prompt_tokens: model.usage.prompt_tokens,
        completion_tokens: model.usage.completion_tokens,
        cached_tokens: model.usage.cached_tokens ?? 0,
        cache_write_tokens: model.usage.cache_write_tokens ?? 0,
      },
    ])
  ),
  ...(spend.delegated.requests
    ? {
        delegated: {
          requests: spend.delegated.requests,
          cost_usd: pricedOrNull(spend.delegated.cost, spend.delegated.requests, spend.delegated.unpriced),
          unpriced_requests: spend.delegated.unpriced,
        },
      }
    : {}),
});

export const runCli = async (argv: string[]): Promise<number> => {
  const parsed = parseArgs(argv);

  if (parsed.version) {
    process.stdout.write(`${JAMCLI_VERSION}\n`);
    return 0;
  }

  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (parsed.unknown.length) {
    process.stderr.write(`Unknown option: ${parsed.unknown.join(', ')}\n\n${USAGE}\n`);
    return 2;
  }

  if (parsed.cwd) {
    process.chdir(parsed.cwd);
  }
  const projectRoot = resolveJamcliProjectRoot();

  if (parsed.audit) {
    return runAuditCli();
  }

  if (parsed.doctor) {
    const { runDoctorCommand } = await import('./cli/doctor.js');
    return runDoctorCommand(parsed.doctor, projectRoot);
  }

  if (parsed.mcpCommand) {
    return runMcpCommand(parsed.mcpCommand, projectRoot);
  }

  if (parsed.authCommand) {
    const { action, args } = parsed.authCommand;
    if (!action) {
      process.stderr.write(`${AUTH_USAGE}\n`);
      return 2;
    }
    return runAuthCommand({ action, args }, projectRoot);
  }

  if (parsed.configCommand) {
    const { action, args } = parsed.configCommand;
    if (!action) {
      process.stderr.write(`${CONFIG_USAGE}\n`);
      return 2;
    }
    return runConfigCommand({ action, args }, projectRoot);
  }

  if (parsed.acp) {
    const { runAcpServer } = await import('./acp/server.js');
    return runAcpServer(projectRoot);
  }

  if (parsed.sessionsCommand) {
    return runSessionsCommand(parsed.sessionsCommand, projectRoot);
  }

  if (!parsed.prompt) {
    process.stderr.write(`${USAGE}\n`);
    return 0;
  }

  let sessionId = parsed.resume;
  if (!sessionId && parsed.continueLast) {
    sessionId = (await latestSessionId(projectRoot)) ?? undefined;
    if (!sessionId) process.stderr.write('No earlier session in this project, so a new one was started.\n');
  }

  // The first interrupt cancels the turn and reports what happened; a second one exits.
  const controller = new AbortController();
  let interrupted = false;
  const onInterrupt = () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    controller.abort();
  };
  process.on('SIGINT', onInterrupt);

  const startedAt = Date.now();
  const streaming = parsed.outputFormat === 'stream-json';
  let outcome: HeadlessResult;
  try {
    outcome = await runHeadless({
      prompt: parsed.prompt,
      projectRoot,
      cwd: process.cwd(),
      maxTurns: parsed.maxTurns,
      model: parsed.model,
      sessionId,
      allowTools: parsed.allowTools,
      denyTools: parsed.denyTools,
      permissions: {
        allowedTools: parsed.allowedTools,
        disallowedTools: parsed.disallowedTools,
        ...(parsed.permissionMode ? { mode: parsed.permissionMode } : {}),
      },
      bypassPermissions: parsed.bypassPermissions,
      dryRun: parsed.dryRun,
      observe: {
        ...(parsed.verbosity ? { level: parsed.verbosity > 1 ? 'debug' : 'info', echo: (line: string) => process.stderr.write(`${line}\n`) } : {}),
        ...(parsed.logFile ? { logFile: parsed.logFile } : {}),
        ...(parsed.traceFile ? { traceFile: parsed.traceFile } : {}),
      },
      signal: controller.signal,
      onEvent: streaming
        ? (event: AgentEvent) => {
            const line = eventToJson(event);
            if (line) process.stdout.write(`${JSON.stringify(line)}\n`);
          }
        : undefined,
    });
  } catch (error: any) {
    process.stderr.write(`${error?.message ?? error}\n`);
    return 1;
  } finally {
    process.off('SIGINT', onInterrupt);
  }

  const { result } = outcome;
  if (parsed.outputFormat === 'text') {
    for (const notice of outcome.notices) process.stderr.write(`${notice.level}: ${notice.message}\n`);
    for (const denial of outcome.permissionDenials) {
      process.stderr.write(`Not run: ${denial.tool}, because ${denial.reason}. Pass --allow-tool ${denial.tool} to allow it.\n`);
    }
    if (result.error && !outcome.notices.some((notice) => notice.message === result.error)) {
      process.stderr.write(`${result.error}\n`);
    }
    if (result.response) process.stdout.write(`${result.response}\n`);
    if (outcome.dryRun) process.stdout.write(dryRunText(outcome.dryRun));
  } else {
    process.stdout.write(`${JSON.stringify(resultToJson(outcome, Date.now() - startedAt))}\n`);
  }

  if (interrupted || result.status === 'cancelled') return 130;
  return result.status === 'ok' ? 0 : 1;
};

/** The last line of `json` and `stream-json` output. */
const resultToJson = (outcome: HeadlessResult, durationMs: number): Record<string, unknown> => ({
  type: 'result',
  session_id: outcome.sessionId,
  status: outcome.result.status,
  response: outcome.result.response,
  ...(outcome.result.error ? { error: outcome.result.error } : {}),
  provider: outcome.provider,
  model: outcome.model,
  duration_ms: durationMs,
  turns: outcome.result.turns,
  usage: serializeUsage(outcome.result.usage),
  ...serializeSpend(outcome.spend),
  permission_mode: outcome.permissionMode,
  sandbox: outcome.sandbox,
  ...(outcome.dryRun
    ? {
        dry_run: outcome.dryRun.map((entry) => ({
          tool: entry.tool,
          call_id: entry.callId,
          summary: entry.summary,
          ...(entry.preview ? { preview: entry.preview } : {}),
        })),
      }
    : {}),
  permission_denials: outcome.permissionDenials.map((denial) => ({
    tool: denial.tool,
    call_id: denial.callId,
    arguments: denial.arguments,
    reason: denial.reason,
  })),
  notices: outcome.notices,
});

/** The dry run's report in text: each call not made, with its diff or command. */
const dryRunText = (entries: NonNullable<HeadlessResult['dryRun']>): string => {
  if (!entries.length) return '\nDry run: nothing would have changed.\n';
  const lines = [`\nDry run: ${entries.length} call${entries.length === 1 ? ' was' : 's were'} not made.`];
  for (const entry of entries) {
    lines.push(`- ${entry.summary}`);
    if (entry.preview?.text) lines.push(...entry.preview.text.split('\n').map((line) => `    ${line}`));
  }
  return `${lines.join('\n')}\n`;
};

/** One `stream-json` line per event worth reporting; the rest are left out. */
const eventToJson = (event: AgentEvent): Record<string, unknown> | null => {
  switch (event.type) {
    case 'text':
      return { type: 'text', delta: event.delta };
    case 'reasoning':
      return { type: 'reasoning', delta: event.delta };
    case 'tool_call':
      return { type: 'tool_call', id: event.call.id, tool: event.call.name, arguments: event.call.arguments };
    case 'tool_progress':
      return { type: 'tool_progress', id: event.callId, tool: event.tool, chunk: event.chunk };
    case 'tool_result':
      return {
        type: 'tool_result',
        id: event.result.callId,
        tool: event.result.tool,
        status: event.result.status,
        success: event.result.success,
        output: event.result.output,
        duration_ms: event.result.durationMs,
      };
    case 'approval_request':
      return { type: 'approval_request', id: event.call.id, tool: event.call.name, reason: event.request?.reason };
    case 'approval_decision':
      return {
        type: 'approval_decision',
        id: event.callId,
        tool: event.tool,
        allow: event.allow,
        by: event.by,
        ...(event.rule ? { rule: event.rule } : {}),
        ...(event.feedback ? { feedback: event.feedback } : {}),
      };
    case 'usage':
      return {
        type: 'usage',
        usage: event.usage,
        ...(event.model ? { model: event.model } : {}),
        cost_usd: event.cost ?? null,
        ...(event.delegatedSession ? { delegated_session: event.delegatedSession } : {}),
      };
    case 'retry':
      return { type: 'retry', attempt: event.attempt, delay_ms: event.delayMs, reason: event.reason };
    case 'notice':
      return { type: 'notice', level: event.level ?? 'info', message: event.message, ...(event.code ? { code: event.code } : {}) };
    default:
      return null;
  }
};

const runSessionsCommand = async (
  command: { action: SessionsAction; query?: string },
  projectRoot: string
): Promise<number> => {
  if (command.action === 'list') {
    const sessions = await listSessions(projectRoot, 20);
    for (const session of sessions) {
      process.stdout.write(`${session.id}\t${session.updated}\t${session.firstUserMessage ?? ''}\n`);
    }
    return 0;
  }

  if (command.action === 'search') {
    if (!command.query) {
      process.stderr.write('Usage: jamcli sessions search <query>\n');
      return 2;
    }
    const sessions = await searchSessions(projectRoot, command.query);
    for (const session of sessions) {
      process.stdout.write(`${session.id}\t${session.updated}\t${session.firstUserMessage ?? ''}\n`);
    }
    return 0;
  }

  if (!command.query) {
    process.stderr.write(`Usage: jamcli sessions ${command.action} <session-id>\n`);
    return 2;
  }
  const messages = await loadSessionMessages(projectRoot, command.query);
  if (!messages.length) {
    process.stderr.write(`No session named ${command.query} with recorded messages in this project.\n`);
    return 1;
  }
  if (command.action === 'show') {
    process.stdout.write(await renderSession(projectRoot, command.query));
    return 0;
  }
  if (command.action === 'fork') {
    const forked = await forkSession(projectRoot, command.query, { surface: 'cli' });
    process.stdout.write(`${forked}\n`);
    return 0;
  }
  const path = await exportSession(projectRoot, command.query);
  process.stdout.write(`${messages.length} messages exported to ${path}\n`);
  return 0;
};
