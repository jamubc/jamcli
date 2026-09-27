import { createRuntime, type DryRunEntry, type RunOptions, type Runtime, type RuntimeOptions } from '../core/runtime/index.js';
import { CommandHost, entryText } from '../commands/host.js';
import { hostClipboard } from '../utils/clipboard.js';
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
  /** `--choose`: answers to the lists a command offers, in order. */
  choose?: string[];
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
  const onEvent = (event: AgentEvent) => {
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
  };
  const clipboard = hostClipboard();
  try {
    // A prompt naming a command runs it, as the interface would; any other text, a path such as /tmp included, is sent as written.
    const output: string[] = [];
    const turns: RunResult[] = [];
    const host = new CommandHost({
      runtime,
      projectRoot: options.projectRoot,
      onEntry: (entry) => {
        if (entry.kind === 'event') return onEvent(entry.event);
        if (entry.kind === 'notice') return void notices.push({ level: entry.level, message: entry.text });
        output.push(entryText(entry));
      },
      runTurn: async (prompt, { display: _display, ...turn }) => turns.push(await runtime.run(prompt, onEvent, turn)),
      openRefusal: 'A headless run keeps one session. Continue another with --resume <id>, or the latest with --continue.',
      answerHint: 'Answer it in advance with --choose <number or key>.',
      laterInput: false,
      answers: options.choose ?? [],
      copy: async (text) => ((await clipboard.write(text)) ? 'system' : false),
    });
    await host.load();
    let result: RunResult;
    if (host.commandFor(options.prompt)) {
      await host.run(options.prompt);
      const turn = turns.at(-1);
      // A command that ends refused, in error, or wanting an argument fails the run, as the interface would say so.
      const failed = [...notices].reverse().find((notice) => notice.level !== 'info');
      const response = [...output, turn?.response ?? ''].filter(Boolean).join('\n\n');
      result = turn
        ? { ...turn, response }
        : {
            status: failed ? 'error' : 'ok',
            sessionId: runtime.sessionId,
            response,
            turns: 0,
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            ...(failed ? { error: failed.message } : {}),
          };
    } else {
      result = await runtime.run(options.prompt, onEvent);
    }
    return {
      result,
      sessionId: runtime.sessionId,
      ...runtime.model,
      permissionDenials,
      notices,
      permissionMode: options.dryRun ? 'plan' : runtime.permissionMode,
      sandbox: runtime.sandbox.kind,
      ...(options.dryRun ? { dryRun: runtime.dryRunReport } : {}),
      spend: runtime.spend(),
    };
  } finally {
    clipboard.dispose();
    await runtime.close();
  }
};
