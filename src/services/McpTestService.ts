import type { McpServerConfig, McpTestResult } from '../types/mcp.js';
import { connectMcp } from '../core/mcp/connect.js';
import { serverEnv } from './McpManager.js';

const HANDSHAKE_TIMEOUT_MS = 8000;

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

/**
 * Connect to one server as a session would, list its tools, and say which protocol
 * revision it speaks. Nothing is kept: the connection is closed at once.
 */
export class McpTestService {
  async testServer(server: McpServerConfig, projectRoot: string, env: Record<string, string> = serverEnv(server)): Promise<McpTestResult> {
    const start = Date.now();
    if (server.transport !== 'http' && !server.url && !server.command) {
      return { status: 'failed', message: 'Invalid server configuration (missing command)', timestamp: start };
    }
    let connection: Awaited<ReturnType<typeof connectMcp>> | undefined;
    try {
      connection = await withTimeout(connectMcp({ ...server, cwd: server.cwd || projectRoot }, { env }), HANDSHAKE_TIMEOUT_MS, 'The connection');
      const tools = await withTimeout(connection.client.listTools(), HANDSHAKE_TIMEOUT_MS, 'tools/list');
      const toolCount = tools.tools?.length ?? 0;
      return {
        status: 'ok',
        message: `Connected on protocol ${connection.protocolVersion}${connection.era === 'legacy' ? ' (a 2025 server, through the fallback handshake)' : ''}; ${toolCount} tool${toolCount === 1 ? '' : 's'}.`,
        latencyMs: Date.now() - start,
        timestamp: Date.now(),
        toolCount,
      };
    } catch (error: any) {
      return { status: 'failed', message: `Could not connect: ${error?.message || error}`, latencyMs: Date.now() - start, timestamp: Date.now() };
    } finally {
      await connection?.client.close().catch(() => undefined);
    }
  }
}
