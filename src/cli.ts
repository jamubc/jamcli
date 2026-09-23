import { runHeadless } from './cli/run.js';
import { runAuditCli } from './cli/audit.js';
import { listSessions, latestSessionId, loadSessionMessages, searchSessions, exportSession } from './core/session/store.js';
import { resolveJamcliProjectRoot } from './utils/projectRoot.js';
import type { AgentEvent } from './core/types.js';

export interface ParsedArgs {
  prompt?: string;
  outputFormat: 'text' | 'json' | 'stream-json';
  cwd?: string;
  maxTurns?: number;
  resume?: string;
  continueLast: boolean;
  allowTools: string[];
  denyTools: string[];
  sessionsCommand?: { action: 'list' | 'search' | 'export'; query?: string };
  audit: boolean;
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
    help: false,
    version: false,
    audit: false,
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
    if (token === '--deny-tool') {
      parsed.denyTools.push(argv[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      parsed.help = true;
      continue;
    }
    if (token === '--version' || token === '-v') {
      parsed.version = true;
      continue;
    }
    if (token === 'audit') {
      parsed.audit = true;
      continue;
    }
    if (token === 'sessions') {
      const action = argv[i + 1];
      if (action === 'list' || action === 'search' || action === 'export') {
        parsed.sessionsCommand = { action, query: argv[i + 2] };
        i += 2;
      }
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
      --resume <session-id>    Continue an existing session
      --continue               Continue the most recent session
      --allow-tool <name>      Allow a tool for this run (repeatable)
      --deny-tool <name>       Deny a tool for this run (repeatable)

  jamcli sessions list|search <query>|export <id>
  jamcli audit                 Report tool access, isolation, and guardrail findings

  --help                       Show this help
  --version                    Show the version`;

const serializeUsage = (usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) =>
  usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

export const runCli = async (argv: string[]): Promise<number> => {
  const parsed = parseArgs(argv);

  if (parsed.version) {
    process.stdout.write(`${process.env.npm_package_version ?? '1.0.0'}\n`);
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

  if (parsed.sessionsCommand) {
    return runSessionsCommand(parsed.sessionsCommand, projectRoot);
  }

  if (!parsed.prompt) {
    process.stderr.write(`${USAGE}\n`);
    return 0;
  }

  const sessionId = parsed.resume ? parsed.resume : parsed.continueLast ? (await latestSessionId(projectRoot)) ?? undefined : undefined;
  const startedAt = Date.now();

  const { result } = await runHeadless({
    prompt: parsed.prompt,
    projectRoot,
    maxTurns: parsed.maxTurns,
    sessionId,
    allowTools: parsed.allowTools,
    denyTools: parsed.denyTools,
    onEvent:
      parsed.outputFormat === 'stream-json'
        ? (event: AgentEvent) => {
            process.stdout.write(`${JSON.stringify(eventToJson(event))}\n`);
          }
        : undefined,
  });

  const durationMs = Date.now() - startedAt;

  if (parsed.outputFormat === 'json' || parsed.outputFormat === 'stream-json') {
    process.stdout.write(
      `${JSON.stringify({
        session_id: result.sessionId,
        status: result.status,
        response: result.response,
        duration_ms: durationMs,
        turns: result.turns,
        usage: serializeUsage(result.usage),
      })}\n`
    );
  } else {
    process.stdout.write(`${result.response}\n`);
  }

  if (result.status === 'ok') return 0;
  return 1;
};

const eventToJson = (event: AgentEvent): Record<string, unknown> => {
  switch (event.type) {
    case 'text':
      return { type: 'text', delta: event.delta };
    case 'reasoning':
      return { type: 'reasoning', delta: event.delta };
    case 'tool_call':
      return { type: 'tool_call', tool: event.call.name, arguments: event.call.arguments };
    case 'tool_result':
      return { type: 'tool_result', tool: event.result.tool, success: event.result.success };
    case 'usage':
      return { type: 'usage', usage: event.usage };
    case 'approval_request':
      return { type: 'approval_request', tool: event.call.name };
    default:
      return { type: 'unknown' };
  }
};

const runSessionsCommand = async (
  command: { action: 'list' | 'search' | 'export'; query?: string },
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
    process.stderr.write('Usage: jamcli sessions export <session-id>\n');
    return 2;
  }
  const messages = await loadSessionMessages(projectRoot, command.query);
  const path = await exportSession(projectRoot, command.query);
  process.stdout.write(`${messages.length} messages exported to ${path}\n`);
  return 0;
};
