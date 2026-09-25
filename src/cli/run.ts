import { createRuntime, type DryRunEntry, type RunOptions, type Runtime, type RuntimeOptions } from '../core/runtime/index.js';
import { expandCommand, loadCommands } from '../core/ext/commands.js';
import { promptArguments } from '../core/mcp/prompts.js';
import type { AgentEvent, RunResult } from '../core/types.js';
import type { SpendSummary } from '../core/catalog/cost.js';

export interface HeadlessOptions {
  prompt: string;
  projectRoot: string;
  /** `--worktree`: the worktree's project directory, where the tools work. */
  workTree?: string;
  cwd?: string;
  maxTurns?: number;
  model?: string;
  sessionId?: string;
  allowTools?: string[];
  denyTools?: string[];
  /** `--allowed-tools`, `--disallowed-tools`, and `--permission-mode`. */
  permissions?: RuntimeOptions['permissions'];
  bypassPermissions?: boolean;
  dryRun?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  /** Log level and files, from `-v`, `-vv`, `--log-file`, and `--trace-file`. */
  observe?: RuntimeOptions['observe'];
  /** Assembly overrides, for tests. */
  runtime?: Partial<RuntimeOptions>;
}

/** A call the run could not ask about, and so did not make. */
export interface PermissionDenial {
  tool: string;
  callId: string;
  arguments: Record<string, unknown>;
  reason: string;
}

export interface HeadlessResult {
  result: RunResult;
  sessionId: string;
  provider: string;
  model: string;
  permissionDenials: PermissionDenial[];
  notices: { level: 'info' | 'warn' | 'error'; message: string }[];
  permissionMode: string;
  sandbox: string;
  /** In a dry run, each call that would have changed something. */
  dryRun?: DryRunEntry[];
  /** What the session has cost, by model. */
  spend: SpendSummary;
}

/**
 * One prompt without the interface. Nobody is there to answer an approval request, so a
 * call that would ask is not made: the model is told why and how to allow it, and the
 * run carries on. The denial is recorded as decided by the mode, not by a person.
 */
export const runHeadless = async (options: HeadlessOptions): Promise<HeadlessResult> => {
  const runtime = await createRuntime({
    projectRoot: options.projectRoot,
    ...(options.workTree ? { workTree: options.workTree } : {}),
    cwd: options.cwd,
    surface: 'headless',
    sessionId: options.sessionId,
    model: options.model,
    allowTools: options.allowTools,
    denyTools: options.denyTools,
    permissions: options.permissions,
    bypassPermissions: options.bypassPermissions,
    dryRun: options.dryRun,
    maxSteps: options.maxTurns,
    signal: options.signal,
    observe: options.observe,
    ...options.runtime,
  });
  const permissionDenials: PermissionDenial[] = [];
  const notices: HeadlessResult['notices'] = [];
  try {
    const { prompt, turn } = await customCommandTurn(options.prompt, options.projectRoot, runtime);
    const result = await runtime.run(prompt, (event) => {
      if (event.type === 'approval_request') {
        const reason = event.request?.reason ?? 'this tool asks before it runs';
        permissionDenials.push({ tool: event.call.name, callId: event.call.id, arguments: event.call.arguments ?? {}, reason });
        event.decide({
          allow: false,
          by: 'mode',
          feedback: `a headless run cannot ask for approval, and ${reason}. The user can pass --allow-tool ${event.call.name} to allow it.`,
        });
      } else if (event.type === 'notice') {
        notices.push({ level: event.level ?? 'info', message: event.message });
      }
      options.onEvent?.(event);
    }, turn);
    return {
      result,
      sessionId: runtime.sessionId,
      ...runtime.model,
      permissionDenials,
      notices,
      permissionMode: runtime.permissionMode,
      sandbox: runtime.sandbox.kind,
      ...(options.dryRun ? { dryRun: runtime.dryRunReport } : {}),
      spend: runtime.spend(),
    };
  } finally {
    await runtime.close();
  }
};

/**
 * A prompt that names a custom command, as `/review src`, runs as the command's prompt with
 * its front matter's model and tools. Any other text, a path such as `/tmp` included, is
 * sent as written.
 */
async function customCommandTurn(text: string, projectRoot: string, runtime: Runtime): Promise<{ prompt: string; turn: RunOptions }> {
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim());
  if (!match) return { prompt: text, turn: {} };
  const command = loadCommands(projectRoot).commands.find((entry) => entry.name === match[1].toLowerCase());
  if (!command) {
    // `/server:prompt` names an MCP server's prompt.
    const prompt = match[1].includes(':') ? (await runtime.mcpPrompts()).find((entry) => `${entry.serverId}:${entry.name}`.toLowerCase() === match[1].toLowerCase()) : undefined;
    if (!prompt) return { prompt: text, turn: {} };
    const { args, missing } = promptArguments(prompt, match[2]);
    if (missing.length) throw new Error(`/${match[1]} needs ${missing.join(' and ')}.`);
    return { prompt: await runtime.mcpPrompt(prompt.serverId, prompt.name, args), turn: { label: `/${match[1]}` } };
  }
  return {
    prompt: expandCommand(command, match[2]),
    turn: { label: `/${command.name}`, ...(command.model ? { model: command.model } : {}), ...(command.allowedTools ? { allowedTools: command.allowedTools } : {}) },
  };
}
