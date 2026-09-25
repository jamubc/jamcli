import { spawn } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getStateDir } from '../../utils/paths.js';
import type { ToolCall } from '../types.js';
import type { HookBus, HookEventName, HookPayloads, HookVerdict } from './index.js';

/**
 * User hooks (D17): commands the configuration runs at lifecycle events. A hook reads the
 * event as JSON on standard input. Exit 0 continues, and standard output may be a JSON
 * verdict; exit 2 blocks, with standard error as the reason; any other exit is a failure
 * that is reported while the turn goes on. Hooks subscribe to the in-process hook bus.
 */

export const USER_HOOK_EVENTS = ['session_start', 'user_prompt_submit', 'pre_tool', 'post_tool', 'stop', 'pre_compact', 'notification', 'session_end'] as const;
export type UserHookEvent = (typeof USER_HOOK_EVENTS)[number];

/** Where a hook was configured. The project's and the local file's need the person's trust. */
export type HookScope = 'user' | 'project' | 'local' | 'env' | 'plugin';

export interface HookSetting {
  /** For tool events, a rule such as `run_command(git push*)` or `edit`; absent matches every call. */
  matcher?: string;
  command: string;
  timeout_ms?: number;
  /** `false` keeps the hook configured without running it. */
  enabled?: boolean;
}

export type HookSettings = Partial<Record<UserHookEvent, HookSetting[]>>;

export interface HookCommand extends HookSetting {
  event: UserHookEvent;
  scope: HookScope;
  /** The file it came from, as messages name it. */
  source: string;
}

export interface HookOutput {
  decision?: 'allow' | 'deny' | 'ask';
  reason?: string;
  additional_context?: string;
  updated_input?: Record<string, unknown>;
}

export type HookRun =
  | { kind: 'ok'; output?: HookOutput; stdout: string }
  | { kind: 'block'; reason: string }
  | { kind: 'failed'; message: string };

export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

/** Every hook the layers configure, each with where it came from. */
export function hooksFromLayers(layers: { scope: string; label: string; values: { hooks?: HookSettings } }[]): HookCommand[] {
  const found: HookCommand[] = [];
  for (const layer of layers) {
    if (!layer.values.hooks || !['user', 'project', 'local', 'env'].includes(layer.scope)) continue;
    for (const event of USER_HOOK_EVENTS) {
      for (const setting of layer.values.hooks[event] ?? []) found.push({ ...setting, event, scope: layer.scope as HookScope, source: layer.label });
    }
  }
  return found;
}

/** Hooks the project brings, which run only once the person trusts them. */
export const needsTrust = (hook: HookCommand) => hook.scope === 'project' || hook.scope === 'local';

/** What the project's hooks are, as one value: trust is given to these and lapses when they change. */
export function hooksDigest(hooks: HookCommand[]): string {
  const project = hooks.filter(needsTrust).map(({ event, matcher, command, timeout_ms }) => ({ event, matcher, command, timeout_ms }));
  return createHash('sha256').update(JSON.stringify(project)).digest('hex');
}

/** The projects whose hooks the person has trusted, kept in the state directory, not the project. */
export class HookTrust {
  constructor(private readonly file = path.join(getStateDir(), 'trusted-hooks.json')) {}

  private read(): Record<string, string> {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  isTrusted(projectRoot: string, digest: string): boolean {
    return this.read()[path.resolve(projectRoot)] === digest;
  }

  trust(projectRoot: string, digest: string): void {
    const data = { ...this.read(), [path.resolve(projectRoot)]: digest };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  }
}

export interface HookRunContext {
  cwd: string;
  /** The environment a hook starts with: the session's minimal one. */
  env: Record<string, string>;
  /** Run inside the session's sandbox, when it has one. */
  wrap?: (command: string, options: { cwd: string; env: Record<string, string> }) => { file: string; args: string[] };
  signal?: AbortSignal;
}

/** Run one hook with the event on its standard input, and read what it says. */
export function runHookCommand(hook: Pick<HookCommand, 'command' | 'timeout_ms'>, input: unknown, context: HookRunContext): Promise<HookRun> {
  const timeout = hook.timeout_ms ?? DEFAULT_HOOK_TIMEOUT_MS;
  const [file, args] = context.wrap
    ? (({ file, args }) => [file, args] as const)(context.wrap(hook.command, { cwd: context.cwd, env: context.env }))
    : process.platform === 'win32'
      ? (['cmd.exe', ['/d', '/s', '/c', hook.command]] as const)
      : (['/bin/sh', ['-c', hook.command]] as const);
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (run: HookRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    };
    const child = spawn(file, [...args], { cwd: context.cwd, env: context.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const kill = () => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(() => {
      kill();
      finish({ kind: 'failed', message: `it did not finish within ${timeout} ms` });
    }, timeout);
    context.signal?.addEventListener('abort', () => {
      kill();
      finish({ kind: 'failed', message: 'the turn was cancelled' });
    });
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => finish({ kind: 'failed', message: error.message }));
    child.on('close', (code) => {
      if (code === 2) return finish({ kind: 'block', reason: stderr.trim() || 'a hook blocked it' });
      if (code !== 0) return finish({ kind: 'failed', message: `it exited with ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}` });
      const text = stdout.trim();
      if (!text.startsWith('{')) return finish({ kind: 'ok', stdout });
      const parsed = parseHookOutput(text);
      if (typeof parsed === 'string') return finish({ kind: 'failed', message: parsed });
      finish({ kind: 'ok', output: parsed, stdout });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

/** A hook's JSON verdict, or why it is not one. */
export function parseHookOutput(text: string): HookOutput | string {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return 'its output starts like JSON but is not JSON';
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'its output is not a JSON object';
  if (data.decision !== undefined && !['allow', 'deny', 'ask'].includes(data.decision)) return `its decision "${data.decision}" is not allow, deny, or ask`;
  if (data.updated_input !== undefined && (typeof data.updated_input !== 'object' || data.updated_input === null || Array.isArray(data.updated_input))) {
    return 'its updated_input is not an object';
  }
  return {
    ...(data.decision ? { decision: data.decision } : {}),
    ...(typeof data.reason === 'string' ? { reason: data.reason } : {}),
    ...(typeof data.additional_context === 'string' ? { additional_context: data.additional_context } : {}),
    ...(data.updated_input ? { updated_input: data.updated_input } : {}),
  };
}

/** The JSON a hook reads: the event, the session, and what the event is about. */
export function hookInput<K extends UserHookEvent>(event: K, payload: HookPayloads[K], base: { projectRoot: string; cwd: string; surface: string }): Record<string, unknown> {
  const common = { event, session_id: payload.session.id, project_root: base.projectRoot, cwd: base.cwd, surface: base.surface };
  const tool = (call: ToolCall) => ({ tool_name: call.name, tool_input: call.arguments ?? {}, tool_call_id: call.id });
  switch (event) {
    case 'pre_tool':
      return { ...common, ...tool((payload as HookPayloads['pre_tool']).call) };
    case 'post_tool': {
      const post = payload as HookPayloads['post_tool'];
      return { ...common, ...tool(post.call), tool_output: post.output, tool_status: post.result.status ?? (post.result.success ? 'ok' : 'error') };
    }
    case 'user_prompt_submit':
      return { ...common, prompt: (payload as HookPayloads['user_prompt_submit']).prompt };
    case 'stop': {
      const stop = payload as HookPayloads['stop'];
      return { ...common, response: stop.response, stop_hook_active: stop.stopHookActive };
    }
    case 'pre_compact': {
      const compact = payload as HookPayloads['pre_compact'];
      return { ...common, trigger: compact.trigger, ...(compact.focus ? { focus: compact.focus } : {}) };
    }
    case 'notification': {
      const note = payload as HookPayloads['notification'];
      return { ...common, message: note.message, level: note.level };
    }
    case 'session_start':
      return { ...common, source: (payload as HookPayloads['session_start']).source ?? 'new' };
    default: {
      const end = payload as HookPayloads['session_end'];
      return { ...common, status: end.status, turns: end.turns };
    }
  }
}

/** Events whose plain standard output, not JSON, is context for the model, as it is elsewhere. */
const TEXT_IS_CONTEXT = new Set<UserHookEvent>(['session_start', 'user_prompt_submit']);

export interface SubscribeOptions {
  hooks: HookCommand[];
  base: { projectRoot: string; cwd: string; surface: string };
  context: () => HookRunContext;
  /** Whether a tool call is one a matcher names, judged as a permission rule would be. */
  matches: (matcher: string, call: ToolCall) => boolean;
  /** Told of each hook that ran, for the log and traces. */
  onRun?: (hook: HookCommand, run: HookRun, ms: number) => void;
}

/**
 * Put each enabled hook on the bus. A hook's handler runs it and returns its verdict; a
 * failure is thrown, so the bus reports it as a notice and the turn goes on.
 */
export function subscribeHooks(bus: HookBus, options: SubscribeOptions): () => void {
  const unsubscribe: (() => void)[] = [];
  for (const hook of options.hooks) {
    if (hook.enabled === false) continue;
    const name = `${hook.source} ${hook.event}${hook.matcher ? ` ${hook.matcher}` : ''}: ${hook.command}`;
    const handler = async (payload: HookPayloads[UserHookEvent]): Promise<Partial<HookVerdict> | undefined> => {
      if (hook.matcher && (hook.event === 'pre_tool' || hook.event === 'post_tool')) {
        if (!options.matches(hook.matcher, (payload as HookPayloads['pre_tool']).call)) return undefined;
      }
      const started = Date.now();
      const run = await runHookCommand(hook, hookInput(hook.event, payload as never, options.base), options.context());
      options.onRun?.(hook, run, Date.now() - started);
      if (run.kind === 'failed') throw new Error(run.message);
      if (run.kind === 'block') return { block: run.reason };
      const out = run.output;
      const context = out?.additional_context ?? (!out && TEXT_IS_CONTEXT.has(hook.event) ? run.stdout.trim() : undefined);
      return {
        ...(out?.decision ? { decision: out.decision, ...(out.reason ? { reason: out.reason } : {}) } : {}),
        context: context ? [context] : [],
        ...(out?.updated_input ? { updatedInput: out.updated_input } : {}),
      };
    };
    unsubscribe.push(bus.on(hook.event as HookEventName, handler as never, name));
  }
  return () => unsubscribe.forEach((off) => off());
}
