import fs from 'fs';
import path from 'path';
import { McpServer, MissingRequiredClientCapabilityError, inputRequired, inputResponse } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { JAMCLI_VERSION } from '../core/version.js';
import { resolveJamcliProjectRoot } from '../utils/projectRoot.js';
import { DelegatedSession, type SessionReport, type Waiting } from './session.js';
import { DrivenTerminal } from './terminal.js';
import { keyBytes } from '../terminal/terminal.js';

/** How long a call waits for a turn when the caller does not say. */
const DEFAULT_WAIT_MS = 120_000;

export type ToolContext = { mcpReq: { _meta?: { progressToken?: string | number }; signal: AbortSignal; notify(notification: unknown): Promise<void>; elicitInput(request: unknown): Promise<{ action: string; content?: Record<string, unknown> }>; inputResponses?: unknown } };

/** A tool's result: the report as text a model reads, and as structured content a program reads. */
const reply = (report: SessionReport) => ({
  content: [{ type: 'text' as const, text: reportText(report) }],
  structuredContent: report as unknown as Record<string, unknown>,
});

const failure = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

/** The report in words: the status, what happened, and what it waits on with how to answer it. */
export function reportText(report: SessionReport): string {
  const lines = [`Session ${report.session} is ${report.status}${report.ended && report.status === 'idle' ? ` (the last turn ended ${report.ended})` : ''}. Model ${report.model}${report.mode ? `, ${report.mode} mode` : ''}.`];
  if (report.output.trim()) lines.push('', report.output.trim());
  const waiting = report.waiting;
  if (waiting?.kind === 'approval') {
    lines.push('', `Waiting for approval: ${waiting.from ? `${waiting.from.title} (agent ${waiting.from.agent}) asks to ` : ''}${waiting.summary}. ${waiting.reason}.`);
    if (waiting.preview?.text) lines.push(waiting.preview.text);
    if (waiting.personOnly) lines.push('Only the person answers this; they are being asked.');
    else {
      lines.push('Answer with session_answer: approval allow_once, allow_session, or deny.');
      lines.push(waiting.suggestions.length ? `allow_session grants, with pattern, one of: ${waiting.suggestions.join(', ')}. Without a pattern it grants the first.` : 'No grant can cover this call: allow_session allows it this once, and it asks again next time.');
    }
  } else if (waiting?.kind === 'choice') {
    lines.push('', waiting.title, ...waiting.items.map((item, index) => `  ${index + 1}. ${item.label}${item.detail ? ` · ${item.detail}` : ''}  [${item.key}]`));
    lines.push(waiting.personOnly ? 'Only the person answers this; they are being asked.' : 'Answer with session_answer: choice <key or number>, or none.');
  }
  return lines.join('\n');
}

/** The question put to the person, as one enumerated answer. */
function personQuestion(session: DelegatedSession, waiting: Waiting) {
  if (waiting.kind === 'approval') {
    return {
      message: `JamCLI session ${session.id} asks you, not the agent driving it: allow ${waiting.summary}? ${waiting.reason}.${waiting.preview?.text ? `\n\n${waiting.preview.text}` : ''}`,
      requestedSchema: { type: 'object' as const, properties: { answer: { type: 'string' as const, enum: ['allow', 'deny'], description: 'Allow this call once, or deny it.' } }, required: ['answer'] },
    };
  }
  return {
    message: `JamCLI session ${session.id} asks you, not the agent driving it: ${waiting.title}`,
    requestedSchema: { type: 'object' as const, properties: { answer: { type: 'string' as const, enum: waiting.items.map((item) => item.key), description: waiting.items.map((item) => `${item.key}: ${item.label}`).join('; ') } }, required: ['answer'] },
  };
}

/** A name for the question that survives the retry a 2026-07-28 client makes after answering it. */
const questionKey = (waiting: Waiting) => `person-${waiting.kind}-${waiting.id}`.replace(/[^A-Za-z0-9_-]/g, '_');

type PersonAnswer = { action: string; content?: Record<string, unknown> };

/**
 * Ask the person, never the agent: by elicitation pushed to a 2025 host, or, for a host on
 * the 2026-07-28 revision, by returning the question for the host to ask before it retries
 * the call, whose retry carries the answer under `key`. A host that cannot ask answers
 * `unsupported`, which callers treat as a no.
 */
export async function askPerson(ctx: ToolContext, key: string, question: { message: string; requestedSchema: unknown }): Promise<{ answer: PersonAnswer } | { required: ReturnType<typeof inputRequired> }> {
  const retried = inputResponse(ctx.mcpReq.inputResponses as never, key) as { kind: string } & PersonAnswer;
  if (retried.kind === 'elicit') return { answer: retried };
  try {
    return { answer: await ctx.mcpReq.elicitInput(question) };
  } catch (error) {
    if (error instanceof MissingRequiredClientCapabilityError) return { answer: { action: 'unsupported' } };
    return { required: inputRequired({ inputRequests: { [key]: inputRequired.elicit(question as never) } }) };
  }
}

/** Put the person's answer, or its absence, to the session. */
function applyPersonAnswer(session: DelegatedSession, waiting: Waiting, answer: { action: string; content?: Record<string, unknown> }): void {
  const chosen = answer.action === 'accept' ? String(answer.content?.answer ?? '') : '';
  if (waiting.kind === 'approval') {
    // A decision with no `by` is the person's.
    session.decide(chosen === 'allow' ? { allow: true } : { allow: false, feedback: chosen === 'deny' ? 'the person denied it' : `the person was asked and did not answer (${answer.action})` });
  } else {
    session.send(chosen && waiting.items.some((item) => item.key === chosen) ? `/choose ${chosen}` : '/choose none');
  }
}

/**
 * Wait for the session as the call asked, and put what is the person's to the person.
 * Resolves to the result to return: the report, or, for a client on the 2026-07-28
 * revision, the question the client puts to the person before retrying this call.
 */
async function attend(session: DelegatedSession, ctx: ToolContext, waitMs: number) {
  const deadline = Date.now() + waitMs;
  const token = ctx.mcpReq._meta?.progressToken;
  let told = 0;
  const progress = token === undefined ? undefined : (output: string) => {
    told += 1;
    void ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken: token, progress: told, message: output.slice(-400) } }).catch(() => undefined);
  };
  for (;;) {
    await session.settle(Math.max(0, deadline - Date.now()), ctx.mcpReq.signal, progress);
    const waiting = session.waiting();
    if (!waiting?.personOnly) return reply(session.report());
    const asked = await askPerson(ctx, questionKey(waiting), personQuestion(session, waiting));
    if ('required' in asked) return asked.required;
    const answer = asked.answer;
    applyPersonAnswer(session, waiting, answer);
    if (Date.now() >= deadline) return reply(session.report());
  }
}

/** Whether this call is a retry carrying the person's answers, which must not repeat what the first call did. */
export const isRetry = (ctx: ToolContext) => Boolean(ctx.mcpReq.inputResponses && Object.keys(ctx.mcpReq.inputResponses as object).length);

/**
 * JamCLI as an MCP server: sessions another agent delegates work to, each the same kind of
 * session an editor opens over ACP, with what is the person's put to the person.
 */
export function createMcpServer(sessions = new Map<string, DelegatedSession>(), terminals = new Map<string, DrivenTerminal>()): McpServer {
  const server = new McpServer({ name: 'jamcli', version: JAMCLI_VERSION });
  const find = (id: string) => sessions.get(id);
  const stopped = new Set<string>();
  const unknown = (id: string) => failure(stopped.has(id) ? `Session ${id} was stopped; it stays in history. session_start with resume: "${id}" continues it.` : `No session ${id}. session_start opens one.`);
  const wait = z.number().int().min(0).max(3_600_000).optional().describe(`How long to wait for the turn, in milliseconds, before returning what there is. ${DEFAULT_WAIT_MS} when absent.`);

  server.registerTool(
    'session_start',
    {
      description:
        'Open a JamCLI session in a directory: the same agent, tools, commands, and permissions a person gets in the jamcli interface. Returns the session id for the other session_ tools.',
      inputSchema: z.object({
        cwd: z.string().describe('Absolute path of the directory to work in. Its JamCLI project root is found from it, as jamcli does when started there.'),
        model: z.string().optional().describe('provider:model to use instead of the configured one.'),
        resume: z.string().optional().describe('A session id to continue instead of starting a new session.'),
      }),
    },
    async ({ cwd, model, resume }) => {
      if (!path.isAbsolute(cwd) || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return failure(`${cwd} is not an absolute path to a directory.`);
      let session: DelegatedSession;
      try {
        session = await DelegatedSession.open({ projectRoot: resolveJamcliProjectRoot(cwd), cwd, ...(resume ? { sessionId: resume } : {}) });
      } catch (error: any) {
        return failure(`The session did not open: ${error?.message ?? error}`);
      }
      if (model) {
        try {
          session.controller.setModel?.(model);
        } catch (error: any) {
          await session.close();
          return failure(`The session did not open: ${error?.message ?? error}`);
        }
      }
      sessions.set(session.id, session);
      stopped.delete(session.id);
      return reply(session.report());
    }
  );

  server.registerTool(
    'session_send',
    {
      description:
        'Send a prompt, or any /command a person could type such as /compact or /diff, to a session. Returns when the turn ends, when the session needs an answer, or when wait_ms passes, with everything that happened since you last read the session.',
      inputSchema: z.object({ session: z.string(), text: z.string().describe('The prompt, or a command line starting with /.'), wait_ms: wait }),
    },
    async ({ session: id, text, wait_ms }, ctx) => {
      const session = find(id);
      if (!session) return unknown(id);
      if (!isRetry(ctx as ToolContext)) {
        try {
          session.send(text);
        } catch (error: any) {
          return failure(error?.message ?? String(error));
        }
      }
      return attend(session, ctx as ToolContext, wait_ms ?? DEFAULT_WAIT_MS);
    }
  );

  server.registerTool(
    'session_answer',
    {
      description:
        "Answer what a session waits on: a call waiting for approval, or a list a command offered. A call to a tool that always asks, and a choice that is the person's, are put to the person instead and cannot be answered here.",
      inputSchema: z.object({
        session: z.string(),
        approval: z.enum(['allow_once', 'allow_session', 'deny']).optional().describe('The answer to a call waiting for approval.'),
        pattern: z.string().optional().describe('With allow_session: which of the patterns the waiting call offers to grant. The narrowest when absent.'),
        feedback: z.string().optional().describe('With deny: why, which the model reads.'),
        choice: z.string().optional().describe('The key or number of the choice, or none to close the list.'),
        wait_ms: wait,
      }),
    },
    async ({ session: id, approval, feedback, pattern, choice, wait_ms }, ctx) => {
      const session = find(id);
      if (!session) return unknown(id);
      if (!isRetry(ctx as ToolContext)) {
        const waiting = session.waiting();
        if (!waiting) return failure('The session is not waiting on anything.');
        if (waiting.personOnly) return failure(`Only the person answers this (${waiting.kind === 'approval' ? waiting.summary : waiting.title}); they are asked in their own host.`);
        try {
          if (waiting.kind === 'approval') {
            if (!approval) return failure('A call waits for approval: answer with approval allow_once, allow_session, or deny.');
            session.answerApproval(approval, feedback, pattern);
          } else {
            if (!choice) return failure('A list waits: answer with choice <key or number>, or none.');
            session.send(`/choose ${choice}`);
          }
        } catch (error: any) {
          return failure(error?.message ?? String(error));
        }
        // What the answer settles on its way, such as other waiting calls a grant now allows, lands before the session is reported.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return attend(session, ctx as ToolContext, wait_ms ?? DEFAULT_WAIT_MS);
    }
  );

  server.registerTool(
    'session_state',
    {
      description: 'Report a session: whether a turn runs, what happened since you last read it, and what it waits on. With wait_ms, wait that long for the turn first.',
      inputSchema: z.object({ session: z.string(), wait_ms: z.number().int().min(0).max(3_600_000).optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ session: id, wait_ms }, ctx) => {
      const session = find(id);
      if (!session) return unknown(id);
      return attend(session, ctx as ToolContext, wait_ms ?? 0);
    }
  );

  server.registerTool(
    'session_stop',
    { description: 'Stop a session: a running turn is cancelled, and the session stays in history, to resume with session_start.', inputSchema: z.object({ session: z.string() }) },
    async ({ session: id }) => {
      const session = find(id);
      if (!session) return unknown(id);
      sessions.delete(id);
      stopped.add(id);
      await session.close();
      return { content: [{ type: 'text' as const, text: `Stopped session ${id}; it stays in history.` }] };
    }
  );

  registerTerminalTools(server, terminals);
  return server;
}

/** A terminal's screen, with what the interface is doing and where its recording is. */
const screenReply = (terminal: DrivenTerminal, screen: string, note?: string) => {
  const doing =
    terminal.state === 'exited'
      ? `exited with code ${terminal.exitCode}`
      : terminal.personWaits
        ? `waiting on the person to answer ${terminal.waitingOn!.tool}; they are asked, not you`
        : terminal.state === 'requires_action'
          ? terminal.waitingOn?.question
            ? `waiting for an answer to a question from ${terminal.waitingOn.tool}: Up and Down choose, Enter answers, Escape cancels`
            : `waiting for an answer to ${terminal.waitingOn?.tool ?? 'a call'}: 1 allows once, Escape denies`
          : terminal.state;
  const state = { terminal: terminal.id, state: terminal.state, ...(terminal.waitingOn ? { waitingOn: terminal.waitingOn } : {}), recording: terminal.recording, size: terminal.terminal.size };
  return {
    content: [{ type: 'text' as const, text: `${note ? `${note}\n` : ''}Terminal ${terminal.id}: ${doing}. Recording: ${terminal.recording}\n\n${screen.replace(/\n+$/, '')}` }],
    structuredContent: { ...state, screen } as Record<string, unknown>,
  };
};

/**
 * The interface itself, for an agent to use as a person would. Keys meant for a call only
 * the person answers are not sent: the person is asked, and their answer is typed.
 */
function registerTerminalTools(server: McpServer, terminals: Map<string, DrivenTerminal>): void {
  let next = 0;
  const find = (id: string) => terminals.get(id);
  const unknown = (id: string) => failure(`No terminal ${id}. terminal_start opens one.`);
  const wait = z.number().int().min(0).max(600_000).optional().describe('How long to wait for the screen to settle afterwards, in milliseconds. 15000 when absent.');

  /** Send input, unless the interface waits on the person: then ask them, and type their answer. */
  const input = async (terminal: DrivenTerminal, bytes: string, ctx: ToolContext, waitMs: number) => {
    if (terminal.state === 'exited') return { ...screenReply(terminal, await terminal.terminal.drawn(), 'jamcli has exited, so nothing was sent.'), isError: true };
    if (terminal.personWaits) {
      const tool = terminal.waitingOn!.tool;
      const asked = await askPerson(ctx, `terminal-${terminal.id}-${tool}`, {
        message: `The JamCLI interface in terminal ${terminal.id} asks you, not the agent driving it, about ${tool}:\n\n${terminal.terminal.screen().trim()}`,
        requestedSchema: { type: 'object', properties: { answer: { type: 'string', enum: ['allow', 'deny'], description: 'Allow the call once, or deny it.' } }, required: ['answer'] },
      });
      if ('required' in asked) return asked.required;
      const allow = asked.answer.action === 'accept' && asked.answer.content?.answer === 'allow';
      terminal.terminal.type(allow ? '1' : keyBytes('escape')!);
      return screenReply(terminal, await terminal.settle(waitMs, undefined, ctx.mcpReq.signal), `The person was asked about ${tool} and ${allow ? 'allowed it once' : 'did not allow it'}; your input was not sent.`);
    }
    // A retry carries the person's answer to a question that has since been answered; what it would type was already typed.
    if (!isRetry(ctx)) terminal.terminal.type(bytes);
    return screenReply(terminal, await terminal.settle(waitMs, undefined, ctx.mcpReq.signal));
  };

  server.registerTool(
    'terminal_start',
    {
      description:
        'Start the jamcli interface itself in a terminal, in a directory: the same program a person runs, with nothing special for being driven. Use it to try JamCLI as a person would and see what it shows. Returns the terminal id and its screen once it settles.',
      inputSchema: z.object({
        cwd: z.string().describe('Absolute path of the directory to run jamcli in.'),
        args: z.array(z.string()).optional().describe('Arguments to the jamcli interface, such as ["--screen-reader"]. The model is the configured one; /model changes it.'),
        cols: z.number().int().min(20).max(400).optional(),
        rows: z.number().int().min(5).max(200).optional(),
        wait_ms: wait,
      }),
    },
    async ({ cwd, args, cols, rows, wait_ms }, ctx) => {
      if (!path.isAbsolute(cwd) || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return failure(`${cwd} is not an absolute path to a directory.`);
      next += 1;
      const terminal = DrivenTerminal.open(`t${next}`, { cwd, ...(args ? { args } : {}), ...(cols ? { cols } : {}), ...(rows ? { rows } : {}) });
      terminals.set(terminal.id, terminal);
      return screenReply(terminal, await terminal.settle(wait_ms ?? 15_000, undefined, (ctx as ToolContext).mcpReq.signal));
    }
  );

  server.registerTool(
    'terminal_type',
    {
      description: 'Type text into the terminal, as a person types it, then Enter unless enter is false. Returns the screen once it settles.',
      inputSchema: z.object({ terminal: z.string(), text: z.string(), enter: z.boolean().optional(), wait_ms: wait }),
    },
    async ({ terminal: id, text, enter, wait_ms }, ctx) => {
      const terminal = find(id);
      if (!terminal) return unknown(id);
      // Text and its Enter arrive apart, as a person's do: pasted text ending in Enter is taken as a paste, not a send.
      if (enter !== false && !terminal.personWaits && terminal.state !== 'exited') {
        terminal.terminal.type(text);
        await Bun.sleep(100);
        return input(terminal, keyBytes('enter')!, ctx as ToolContext, wait_ms ?? 15_000);
      }
      return input(terminal, text, ctx as ToolContext, wait_ms ?? 15_000);
    }
  );

  server.registerTool(
    'terminal_keys',
    {
      description: 'Press keys in the terminal, in order: enter, escape, tab, shift+tab, up, down, left, right, pageup, pagedown, backspace, space, ctrl+<letter>, or a single character. Returns the screen once it settles.',
      inputSchema: z.object({ terminal: z.string(), keys: z.array(z.string()).min(1), wait_ms: wait }),
    },
    async ({ terminal: id, keys, wait_ms }, ctx) => {
      const terminal = find(id);
      if (!terminal) return unknown(id);
      const unknownKeys = keys.filter((key) => keyBytes(key) === undefined);
      if (unknownKeys.length) return failure(`Not keys: ${unknownKeys.join(', ')}.`);
      return input(terminal, keys.map((key) => keyBytes(key)!).join(''), ctx as ToolContext, wait_ms ?? 15_000);
    }
  );

  server.registerTool(
    'terminal_screen',
    { description: 'The terminal\'s screen as it is now, and what the interface is doing.', inputSchema: z.object({ terminal: z.string() }), annotations: { readOnlyHint: true } },
    async ({ terminal: id }) => {
      const terminal = find(id);
      if (!terminal) return unknown(id);
      return screenReply(terminal, await terminal.terminal.drawn());
    }
  );

  server.registerTool(
    'terminal_wait',
    {
      description: 'Wait until the screen shows text, or, without text, until the interface stops working and the screen is still. Returns the screen.',
      inputSchema: z.object({ terminal: z.string(), text: z.string().optional(), wait_ms: z.number().int().min(0).max(600_000).optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ terminal: id, text, wait_ms }, ctx) => {
      const terminal = find(id);
      if (!terminal) return unknown(id);
      return screenReply(terminal, await terminal.settle(wait_ms ?? 60_000, text, (ctx as ToolContext).mcpReq.signal));
    }
  );

  server.registerTool(
    'terminal_resize',
    { description: 'Resize the terminal, as a person resizing the window does.', inputSchema: z.object({ terminal: z.string(), cols: z.number().int().min(20).max(400), rows: z.number().int().min(5).max(200), wait_ms: wait }) },
    async ({ terminal: id, cols, rows, wait_ms }, ctx) => {
      const terminal = find(id);
      if (!terminal) return unknown(id);
      terminal.terminal.resize(cols, rows);
      return screenReply(terminal, await terminal.settle(wait_ms ?? 15_000, undefined, (ctx as ToolContext).mcpReq.signal));
    }
  );

  server.registerTool(
    'terminal_stop',
    { description: 'Stop the terminal and the jamcli in it. Its recording stays.', inputSchema: z.object({ terminal: z.string() }) },
    async ({ terminal: id }) => {
      const terminal = find(id);
      if (!terminal) return unknown(id);
      terminals.delete(id);
      terminal.close();
      return { content: [{ type: 'text' as const, text: `Stopped terminal ${id}. Its recording is ${terminal.recording} (asciinema v2: asciinema play <file>).` }] };
    }
  );
}

/** `jamcli mcp serve`: MCP on stdio until the host goes away, then every session stops. */
export async function runMcpServer(): Promise<number> {
  const sessions = new Map<string, DelegatedSession>();
  const terminals = new Map<string, DrivenTerminal>();
  const server = createMcpServer(sessions, terminals);
  // The host leaves by closing standard input; until then the server and its sessions stay.
  const left = new Promise<void>((resolve) => {
    process.stdin.once('end', resolve);
    process.stdin.once('close', resolve);
  });
  const served = serveStdio(() => server);
  await left;
  await Promise.allSettled([...sessions.values()].map((session) => session.close()));
  for (const terminal of terminals.values()) terminal.close();
  served.close();
  return 0;
}
