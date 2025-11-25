import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ExecutionService {
  async runShell(command: string, cwd: string = process.cwd()): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(command, { cwd });
      return stdout || stderr;
    } catch (error: any) {
      return error.message;
    }
  }
}
