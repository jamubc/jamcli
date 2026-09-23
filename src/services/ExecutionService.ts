import { formatCommandResult, runShellCommand, DEFAULT_COMMAND_TIMEOUT_MS } from '../core/tools/command.js';

/**
 * The Ink interface's approval path still runs approved commands through this class.
 * It delegates to the core command runner, so those commands get the same timeout,
 * exit code, and output handling as the tool. It is removed with Ink in stage 6.
 */
export class ExecutionService {
  async runShell(command: string, cwd: string = process.cwd()): Promise<string> {
    const result = await runShellCommand({ command, cwd, timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS });
    return formatCommandResult(command, result, DEFAULT_COMMAND_TIMEOUT_MS).output;
  }
}
