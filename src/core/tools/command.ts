import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { resolveProjectPath } from './paths.js';

export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const MAX_COMMAND_TIMEOUT_MS = 600_000;
export const DEFAULT_MAX_OUTPUT_CHARS = 30_000;
/** How long a terminated process group gets before it is killed outright. */
const KILL_GRACE_MS = 2_000;

/**
 * Keeps the beginning and the end of a stream and counts what falls in between, so a
 * command that prints a megabyte costs a bounded amount of memory and context.
 */
export class HeadTailBuffer {
  private head = '';
  private tail = '';
  private total = 0;

  constructor(private readonly limit: number) {}

  push(chunk: string): void {
    this.total += chunk.length;
    const half = Math.floor(this.limit / 2);
    if (this.head.length < half) {
      const room = half - this.head.length;
      this.head += chunk.slice(0, room);
      chunk = chunk.slice(room);
    }
    if (!chunk) return;
    this.tail = (this.tail + chunk).slice(-half);
  }

  get length(): number {
    return this.total;
  }

  /** Characters dropped from the middle. */
  get removed(): number {
    return Math.max(0, this.total - this.head.length - this.tail.length);
  }

  toString(): string {
    if (!this.removed) return this.head + this.tail;
    return `${this.head}\n… [${this.removed} characters removed] …\n${this.tail}`;
  }
}

export interface CommandRunOptions {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputChars?: number;
  onOutput?: (chunk: string) => void;
  wrap?: ToolContext['wrapCommand'];
}

export interface CommandRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  stdout: string;
  stderr: string;
  removedChars: number;
  durationMs: number;
}

const baseEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  return env;
};

const isWindows = process.platform === 'win32';

/** Start a shell command in its own process group so the whole tree can be stopped. */
const startProcess = (options: CommandRunOptions): ChildProcess => {
  const env = options.env ?? baseEnv();
  if (options.wrap) {
    const { file, args } = options.wrap(options.command, { cwd: options.cwd, env });
    return spawn(file, args, { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: !isWindows });
  }
  if (isWindows) {
    return spawn(options.command, { cwd: options.cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  return spawn('/bin/sh', ['-c', options.command], {
    cwd: options.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
};

const stopProcess = (child: ChildProcess): void => {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  const signalTree = (signal: NodeJS.Signals) => {
    try {
      if (isWindows) child.kill(signal);
      else process.kill(-child.pid!, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // Already gone.
      }
    }
  };
  signalTree('SIGTERM');
  const timer = setTimeout(() => signalTree('SIGKILL'), KILL_GRACE_MS);
  timer.unref?.();
  child.once('exit', () => clearTimeout(timer));
};

/** Run a shell command to completion, a timeout, or cancellation. */
export function runShellCommand(options: CommandRunOptions): Promise<CommandRunResult> {
  const started = Date.now();
  const limit = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const stdout = new HeadTailBuffer(limit);
  const stderr = new HeadTailBuffer(Math.max(2_000, Math.floor(limit / 3)));
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, MAX_COMMAND_TIMEOUT_MS);

  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({ exitCode: null, signal: null, timedOut: false, cancelled: true, stdout: '', stderr: '', removedChars: 0, durationMs: 0 });
      return;
    }
    let timedOut = false;
    let cancelled = false;
    let child: ChildProcess;
    try {
      child = startProcess(options);
    } catch (error: any) {
      resolve({
        exitCode: null,
        signal: null,
        timedOut: false,
        cancelled: false,
        stdout: '',
        stderr: `Could not start the command: ${error?.message ?? error}`,
        removedChars: 0,
        durationMs: Date.now() - started,
      });
      return;
    }

    const onData = (buffer: HeadTailBuffer) => (data: Buffer) => {
      const text = data.toString('utf8');
      buffer.push(text);
      options.onOutput?.(text);
    };
    child.stdout?.on('data', onData(stdout));
    child.stderr?.on('data', onData(stderr));

    const timer = setTimeout(() => {
      timedOut = true;
      stopProcess(child);
    }, timeoutMs);
    const onAbort = () => {
      cancelled = true;
      stopProcess(child);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    let settled = false;
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null, spawnError?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (spawnError) stderr.push(`Could not start the command: ${spawnError.message}`);
      resolve({
        exitCode,
        signal,
        timedOut,
        cancelled,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        removedChars: stdout.removed + stderr.removed,
        durationMs: Date.now() - started,
      });
    };
    child.on('error', (error) => finish(null, null, error));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Render a command result the way the model reads it: status first, then output. */
export function formatCommandResult(command: string, result: CommandRunResult, timeoutMs: number): ToolRunPayload {
  let headline: string;
  let status: ToolRunPayload['status'];
  if (result.cancelled) {
    headline = 'Cancelled; the process group was stopped.';
    status = 'cancelled';
  } else if (result.timedOut) {
    headline = `Timed out after ${seconds(timeoutMs)}; the process group was stopped. Output so far is below.`;
    status = 'timeout';
  } else if (result.exitCode === 0) {
    headline = `Exit code 0 after ${seconds(result.durationMs)}.`;
    status = 'ok';
  } else if (result.exitCode !== null) {
    headline = `Exit code ${result.exitCode} after ${seconds(result.durationMs)}.`;
    status = 'error';
  } else {
    headline = `Ended by signal ${result.signal ?? 'unknown'} after ${seconds(result.durationMs)}.`;
    status = 'error';
  }

  const stdout = result.stdout.trimEnd();
  const stderr = result.stderr.trimEnd();
  const sections = [headline];
  if (stdout && stderr) {
    sections.push(`stdout:\n${stdout}`, `stderr:\n${stderr}`);
  } else if (stdout || stderr) {
    sections.push(stdout || `stderr:\n${stderr}`);
  } else {
    sections.push('(no output)');
  }
  return {
    output: sections.join('\n\n'),
    status,
    metadata: {
      command,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      removedChars: result.removedChars,
    },
  };
}

interface Job {
  id: string;
  command: string;
  child: ChildProcess;
  output: HeadTailBuffer;
  unread: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: number;
  endedAt?: number;
}

const jobs = new Map<string, Job>();
let exitHookInstalled = false;

const installExitHook = () => {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const job of jobs.values()) stopProcess(job.child);
  });
};

/** Start a command in the background and return its job at once. */
export function startBackgroundCommand(options: CommandRunOptions): Job {
  installExitHook();
  const child = startProcess(options);
  const job: Job = {
    id: `job_${randomUUID().slice(0, 8)}`,
    command: options.command,
    child,
    output: new HeadTailBuffer(options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS),
    unread: '',
    exitCode: null,
    signal: null,
    startedAt: Date.now(),
  };
  const onData = (data: Buffer) => {
    const text = data.toString('utf8');
    job.output.push(text);
    job.unread = (job.unread + text).slice(-(options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS));
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('close', (code, signal) => {
    job.exitCode = code;
    job.signal = signal;
    job.endedAt = Date.now();
  });
  child.on('error', (error) => {
    job.unread += `\nCould not start the command: ${error.message}`;
    job.endedAt = Date.now();
  });
  jobs.set(job.id, job);
  return job;
}

export const getJob = (id: string): Job | undefined => jobs.get(id);

const jobState = (job: Job): string => {
  if (job.endedAt === undefined) return `running for ${seconds(Date.now() - job.startedAt)}`;
  if (job.exitCode !== null) return `exited with code ${job.exitCode}`;
  return `ended by signal ${job.signal ?? 'unknown'}`;
};

async function runCommandRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const command = args.command;
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('run_command requires a "command" parameter.');
  }
  const cwd =
    typeof args.cwd === 'string' && args.cwd.length
      ? resolveProjectPath(ctx.projectRoot, args.cwd, { additionalRoots: ctx.additionalRoots })
      : ctx.projectRoot;
  const timeoutMs =
    typeof args.timeout_ms === 'number' && args.timeout_ms > 0
      ? Math.min(args.timeout_ms, MAX_COMMAND_TIMEOUT_MS)
      : ctx.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const options: CommandRunOptions = {
    command,
    cwd,
    env: ctx.env,
    timeoutMs,
    signal: ctx.signal,
    maxOutputChars: ctx.maxOutputChars,
    onOutput: ctx.onProgress,
    wrap: ctx.wrapCommand,
  };

  if (args.background === true) {
    const job = startBackgroundCommand(options);
    return {
      output: `Started ${job.id} in the background: ${command}\nRead its output with command_output and stop it with command_kill.`,
      metadata: { command, cwd, jobId: job.id, background: true },
    };
  }

  const result = await runShellCommand(options);
  const payload = formatCommandResult(command, result, timeoutMs);
  // A failure inside a sandbox may be the sandbox's doing; say so, and how to widen it.
  const note = payload.status === 'error' && ctx.sandboxNote ? `\n\n${ctx.sandboxNote}` : '';
  return { ...payload, output: `${payload.output}${note}`, metadata: { ...payload.metadata, cwd } };
}

async function commandOutputRunner(args: Record<string, any>): Promise<ToolRunPayload> {
  const job = getJob(String(args.job_id ?? ''));
  if (!job) throw new Error(`No background job named ${args.job_id}.`);
  const fresh = job.unread;
  job.unread = '';
  const body = args.all === true ? job.output.toString() : fresh;
  return {
    output: `${job.id} (${job.command}) is ${jobState(job)}.\n\n${body.trimEnd() || '(no new output)'}`,
    metadata: { jobId: job.id, running: job.endedAt === undefined, exitCode: job.exitCode },
  };
}

async function commandKillRunner(args: Record<string, any>): Promise<ToolRunPayload> {
  const job = getJob(String(args.job_id ?? ''));
  if (!job) throw new Error(`No background job named ${args.job_id}.`);
  if (job.endedAt === undefined) stopProcess(job.child);
  return { output: `Stopping ${job.id} (${job.command}).`, metadata: { jobId: job.id } };
}

const runCommandSchema: JsonSchema = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'Shell command to run with /bin/sh -c.' },
    cwd: { type: 'string', description: 'Working directory under the project root. Defaults to the project root.' },
    timeout_ms: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_COMMAND_TIMEOUT_MS,
      description: 'Stop the command after this many milliseconds. Defaults to 120000.',
    },
    background: {
      type: 'boolean',
      description: 'Start the command and return a job id at once, for servers and watchers.',
    },
    description: { type: 'string', description: 'A few words on what the command is for, shown to the user.' },
  },
  required: ['command'],
  additionalProperties: false,
};

export const RUN_COMMAND_TOOL: RegisteredTool = {
  name: 'run_command',
  description:
    'Run a shell command in the project. Reports the exit code, stdout, and stderr; long output keeps its beginning and end. Use background for long-running processes.',
  inputSchema: runCommandSchema,
  policy: 'execute',
  runner: runCommandRunner,
};

export const COMMAND_OUTPUT_TOOL: RegisteredTool = {
  name: 'command_output',
  description: 'Read new output from a background command, and whether it is still running.',
  inputSchema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'The job id run_command returned.' },
      all: { type: 'boolean', description: 'Return all retained output instead of only what is new.' },
    },
    required: ['job_id'],
    additionalProperties: false,
  },
  policy: 'read',
  runner: commandOutputRunner,
};

export const COMMAND_KILL_TOOL: RegisteredTool = {
  name: 'command_kill',
  description: 'Stop a background command.',
  inputSchema: {
    type: 'object',
    properties: { job_id: { type: 'string', description: 'The job id run_command returned.' } },
    required: ['job_id'],
    additionalProperties: false,
  },
  policy: 'execute',
  runner: commandKillRunner,
};

export const COMMAND_TOOLS: RegisteredTool[] = [RUN_COMMAND_TOOL, COMMAND_OUTPUT_TOOL, COMMAND_KILL_TOOL];
