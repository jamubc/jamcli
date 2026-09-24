import { createRuntime, type DryRunEntry, type RuntimeOptions } from '../core/runtime/index.js';
import type { AgentEvent, RunResult } from '../core/types.js';

export interface HeadlessOptions {
  prompt: string;
  projectRoot: string;
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
}

/**
 * One prompt without the interface. Nobody is there to answer an approval request, so a
 * call that would ask is not made: the model is told why and how to allow it, and the
 * run carries on. The denial is recorded as decided by the mode, not by a person.
 */
export const runHeadless = async (options: HeadlessOptions): Promise<HeadlessResult> => {
  const runtime = await createRuntime({
    projectRoot: options.projectRoot,
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
    ...options.runtime,
  });
  const permissionDenials: PermissionDenial[] = [];
  const notices: HeadlessResult['notices'] = [];
  try {
    const result = await runtime.run(options.prompt, (event) => {
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
    });
    return {
      result,
      sessionId: runtime.sessionId,
      ...runtime.model,
      permissionDenials,
      notices,
      permissionMode: runtime.permissionMode,
      sandbox: runtime.sandbox.kind,
      ...(options.dryRun ? { dryRun: runtime.dryRunReport } : {}),
    };
  } finally {
    await runtime.close();
  }
};
