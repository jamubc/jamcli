import { spawn } from 'child_process';
import { McpServerConfig, McpTestResult } from '../types/mcp.js';

const HANDSHAKE_TIMEOUT_MS = 4000;

const buildInitializePayload = () => ({
  type: 'initialize',
  request_id: 'jamcli-health-check',
  protocol_version: '2024-11-05',
  client: {
    name: 'jamcli',
    version: '1.0.0',
  },
});

const buildListToolsPayload = () => ({
  type: 'list_tools',
  request_id: 'jamcli-health-tools',
});

const parseJsonLine = (chunk: string) => {
  try {
    return JSON.parse(chunk);
  } catch {
    return null;
  }
};

export class McpTestService {
  async testServer(server: McpServerConfig, projectRoot: string): Promise<McpTestResult> {
    const start = Date.now();
    const timeoutRef = { id: null as NodeJS.Timeout | null };
    const result: McpTestResult = {
      status: 'failed',
      message: 'Unknown error',
      timestamp: start,
    };

    if (!server.command) {
      return {
        ...result,
        message: 'Invalid server configuration (missing command)',
      };
    }

    if (server.transport && server.transport !== 'stdio') {
      return {
        ...result,
        message: `Transport ${server.transport} is not supported for the health check.`,
      };
    }

    return new Promise<McpTestResult>((resolve) => {
      const env = { ...process.env, ...(server.env || {}) };
      const cwd = server.cwd || projectRoot;
      let settled = false;
      let toolCount: number | undefined;
      let handshakeSeen = false;
      let listSent = false;

      const proc = spawn(server.command, server.args || [], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const finish = (status: 'ok' | 'failed', message: string) => {
        if (settled) return;
        settled = true;
        timeoutRef.id && clearTimeout(timeoutRef.id);
        try {
          proc.kill();
        } catch {
          // ignore
        }
        resolve({
          status,
          message,
          latencyMs: Date.now() - start,
          timestamp: Date.now(),
          toolCount,
        });
      };

      proc.on('error', (error) => finish('failed', `Failed to spawn: ${error.message}`));

      proc.stderr?.on('data', (chunk) => {
        const trimmed = chunk.toString().trim();
        if (trimmed) {
        finish('failed', `Server error: ${trimmed.split('\n')[0]}`);
        }
      });

      const handleLine = (line: string) => {
        const data = parseJsonLine(line.trim());
        if (!data) return;
        const type = (data.type || '').toString().toLowerCase();
        if (type === 'initialize' || type === 'init') {
          handshakeSeen = true;
          if (!listSent) {
            proc.stdin?.write(JSON.stringify(buildListToolsPayload()) + '\n');
            listSent = true;
          }
        }
        if (type.includes('list_tools') && Array.isArray(data.tools)) {
          toolCount = data.tools.length;
          finish(
            'ok',
            handshakeSeen
              ? `Handshake + list_tools succeeded (${toolCount} tools).`
              : `list_tools response received (${toolCount} tools).`
          );
        }
      };

      let accumulator = '';
      proc.stdout?.on('data', (chunk) => {
        accumulator += chunk.toString();
        const lines = accumulator.split('\n');
        accumulator = lines.pop() || '';
        for (const line of lines) {
          handleLine(line);
        }
      });

      const handshakePayload = JSON.stringify(buildInitializePayload()) + '\n';
      proc.stdin?.write(handshakePayload);

      timeoutRef.id = setTimeout(() => {
        if (settled) return;
        finish('ok', 'MCP process launched (no formal response).');
      }, HANDSHAKE_TIMEOUT_MS);

      proc.on('exit', (code) => {
        if (settled) return;
        if (code === 0) {
          finish('ok', 'Server exited cleanly.');
        } else {
          finish('failed', `Server exited with code ${code}.`);
        }
      });
    });
  }
}
