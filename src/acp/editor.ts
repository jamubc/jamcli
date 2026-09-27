import type { AgentSideConnection, ClientCapabilities, SessionUpdate } from '@agentclientprotocol/sdk';
import type { EditorBridge, EditorTerminalResult, EditorTerminalRun } from '../types/tools.js';

type Client = Pick<AgentSideConnection, 'readTextFile' | 'writeTextFile' | 'createTerminal'>;
type Update = (sessionId: string, update: SessionUpdate) => Promise<void>;

/**
 * What an editor lends a session, from the capabilities it announced when it connected:
 * its files, through `fs/read_text_file` and `fs/write_text_file`, and its terminals.
 * Nothing when it offers neither. `sessionId` is read at each call, since a new session's
 * id is known only once it is created. What is written is kept in `written` by path, since
 * the disk no longer shows it.
 */
export function editorBridge(
  client: Client,
  capabilities: ClientCapabilities | undefined,
  sessionId: () => string,
  update: Update,
  written: Map<string, string>
): EditorBridge | undefined {
  const bridge: EditorBridge = {};
  if (capabilities?.fs?.readTextFile) bridge.readText = async (path) => (await client.readTextFile({ sessionId: sessionId(), path })).content;
  if (capabilities?.fs?.writeTextFile) {
    bridge.writeText = async (path, content) => {
      await client.writeTextFile({ sessionId: sessionId(), path, content });
      written.set(path, content);
    };
  }
  if (capabilities?.terminal) bridge.terminal = (run) => runInTerminal(client, sessionId(), run, update);
  return Object.keys(bridge).length ? bridge : undefined;
}

/**
 * Run a program in a terminal of the editor's, shown under its tool call, until it exits,
 * its time runs out, or the turn is cancelled. Only starting it can fail: once it runs,
 * whatever goes wrong is reported in the result, so the program is never run twice.
 */
async function runInTerminal(client: Client, sessionId: string, run: EditorTerminalRun, update: Update): Promise<EditorTerminalResult> {
  const terminal = await client.createTerminal({ sessionId, command: run.file, args: run.args, cwd: run.cwd, outputByteLimit: run.outputByteLimit });
  const ended = { terminalId: terminal.id, truncated: false, exitCode: null, signal: null, timedOut: false, cancelled: false };
  try {
    if (run.callId) await update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: run.callId, content: [{ type: 'terminal', terminalId: terminal.id }] });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const stopped = new Promise<'timeout' | 'cancel'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), run.timeoutMs);
      onAbort = () => resolve('cancel');
      if (run.signal?.aborted) resolve('cancel');
      else run.signal?.addEventListener('abort', onAbort, { once: true });
    });
    const how = await Promise.race([terminal.waitForExit().then(() => 'exit' as const), stopped]);
    clearTimeout(timer);
    if (onAbort) run.signal?.removeEventListener('abort', onAbort);
    if (how !== 'exit') await terminal.kill().catch(() => {});
    const { output, truncated, exitStatus } = await terminal.currentOutput();
    return { ...ended, output, truncated, exitCode: exitStatus?.exitCode ?? null, signal: exitStatus?.signal ?? null, timedOut: how === 'timeout', cancelled: how === 'cancel' };
  } catch (error: any) {
    return { ...ended, output: `The editor's terminal failed while the command ran: ${error?.message ?? error}` };
  } finally {
    // The editor keeps showing a released terminal's output under its call.
    await terminal.release().catch(() => {});
  }
}
