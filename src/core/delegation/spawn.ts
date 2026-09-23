import { spawn } from 'child_process';
import type { AgentEvent } from '../types.js';

export interface ChildRunOptions {
  command: string;
  args: string[];
  prompt: string;
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  onNotice?: (line: string) => void;
}

export interface ChildRunResult {
  status: 'ok' | 'error' | 'cancelled';
  sessionId?: string;
  response: string;
  turns?: number;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  events: AgentEvent[];
  stderr: string;
  exitCode: number | null;
}

const parseEventLine = (line: string): AgentEvent | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed.type !== 'string') return null;
    switch (parsed.type) {
      case 'text':
        return { type: 'text', delta: String(parsed.delta ?? '') };
      case 'reasoning':
        return { type: 'reasoning', delta: String(parsed.delta ?? '') };
      case 'tool_call':
        return { type: 'tool_call', call: { id: '', name: String(parsed.tool ?? ''), arguments: parsed.arguments ?? {} } };
      case 'tool_result':
        return {
          type: 'tool_result',
          result: {
            tool: String(parsed.tool ?? ''),
            success: Boolean(parsed.success),
            output: String(parsed.output ?? ''),
            durationMs: 0,
          },
        };
      case 'notice':
        return { type: 'notice', message: String(parsed.message ?? '') };
      default:
        return null;
    }
  } catch {
    return null;
  }
};

export const parseFinalSummary = (line: string): Partial<ChildRunResult> | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed.status !== 'string' || typeof parsed.response !== 'string') return null;
    return {
      status: parsed.status === 'ok' ? 'ok' : 'error',
      sessionId: parsed.session_id,
      response: parsed.response,
      turns: parsed.turns,
      usage: parsed.usage,
    };
  } catch {
    return null;
  }
};

export const runChild = (options: ChildRunOptions): Promise<ChildRunResult> =>
  new Promise((resolve) => {
    const args = [...options.args, '-p', options.prompt, '--output-format', 'stream-json'];
    const child = spawn(options.command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const events: AgentEvent[] = [];
    let summary: Partial<ChildRunResult> | null = null;
    let stderr = '';
    let stdoutBuffer = '';
    let cancelled = false;

    const onAbort = () => {
      cancelled = true;
      child.kill('SIGTERM');
    };
    options.signal?.addEventListener('abort', onAbort);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = parseEventLine(line);
        if (event) {
          events.push(event);
          options.onEvent?.(event);
          continue;
        }
        const finalSummary = parseFinalSummary(line);
        if (finalSummary) {
          summary = finalSummary;
          continue;
        }
        options.onNotice?.(line);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      options.signal?.removeEventListener('abort', onAbort);
      resolve({
        status: 'error',
        response: '',
        events,
        stderr: `${stderr}${error.message}`,
        exitCode: null,
      });
    });

    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort);
      if (stdoutBuffer.trim()) {
        const event = parseEventLine(stdoutBuffer);
        if (event) events.push(event);
        else {
          const finalSummary = parseFinalSummary(stdoutBuffer);
          if (finalSummary) summary = finalSummary;
        }
      }
      const resolved = summary as Partial<ChildRunResult> | null;
      resolve({
        status: cancelled ? 'cancelled' : resolved?.status === 'ok' ? 'ok' : 'error',
        sessionId: resolved?.sessionId,
        response: resolved?.response ?? '',
        turns: resolved?.turns,
        usage: resolved?.usage,
        events,
        stderr,
        exitCode: code,
      });
    });
  });
