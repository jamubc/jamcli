import fs from 'fs-extra';
import path from 'path';
import { McpTestService } from '../services/McpTestService.js';
import type { McpServerConfig, McpTransport } from '../types/mcp.js';

export interface McpCommandRequest {
  action: 'add' | 'list' | 'test' | 'remove';
  args: string[];
}

export interface McpCommandIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const defaultIo: McpCommandIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

const MCP_FILE = 'mcp.json';

export const mcpConfigPath = (projectRoot: string): string => path.join(projectRoot, '.jamcli', MCP_FILE);

/**
 * Read the whole MCP file as-is. Every unrelated key is preserved because the
 * same object is written back after only the servers array is touched.
 */
const readMcpConfig = async (projectRoot: string): Promise<Record<string, any>> => {
  const file = mcpConfigPath(projectRoot);
  if (!(await fs.pathExists(file))) return {};
  try {
    const raw = await fs.readJson(file);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
};

const writeMcpConfig = async (projectRoot: string, config: Record<string, any>): Promise<void> => {
  const file = mcpConfigPath(projectRoot);
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, config, { spaces: 2 });
};

export interface ParsedServer {
  server?: McpServerConfig;
  error?: string;
}

/**
 * Parse `mcp add` arguments. The first bare token is the id; the command can be
 * given with `--command` or as the next bare token, and an HTTP server is
 * declared with `--url`. Remaining flags describe the entry.
 */
export const parseServerArgs = (args: string[]): ParsedServer => {
  const id = args[0];
  if (!id || id.startsWith('-')) {
    return { error: 'Usage: jamcli mcp add <id> [--command <cmd> | --url <url>] [--arg <a>] [--env K=V] [--header K=V] [--cwd <dir>]' };
  }

  let command = '';
  let url = '';
  let declaredTransport: McpTransport | undefined;
  let cwd: string | undefined;
  const serverArgs: string[] = [];
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};

  const readPair = (value: string | undefined, target: Record<string, string>, flag: string): string | undefined => {
    const [key, ...rest] = (value ?? '').split('=');
    if (!key) return `Flag ${flag} expects a KEY=VALUE pair.`;
    target[key.trim()] = rest.join('=').trim();
    return undefined;
  };

  for (let i = 1; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--command') {
      command = args[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (token === '--url') {
      url = args[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (token === '--transport') {
      const value = args[i + 1];
      if (value !== 'stdio' && value !== 'http' && value !== 'sse') {
        return { error: `Unsupported transport: ${value}` };
      }
      declaredTransport = value;
      i += 1;
      continue;
    }
    if (token === '--arg') {
      serverArgs.push(args[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (token === '--cwd') {
      cwd = args[i + 1];
      i += 1;
      continue;
    }
    if (token === '--env') {
      const problem = readPair(args[i + 1], env, '--env');
      if (problem) return { error: problem };
      i += 1;
      continue;
    }
    if (token === '--header') {
      const problem = readPair(args[i + 1], headers, '--header');
      if (problem) return { error: problem };
      i += 1;
      continue;
    }
    if (token.startsWith('--')) {
      return { error: `Unknown option: ${token}` };
    }
    if (!command && !url) {
      command = token;
      continue;
    }
    serverArgs.push(token);
  }

  const usesUrl = Boolean(url) || declaredTransport === 'http' || declaredTransport === 'sse';
  if (usesUrl && !url) return { error: 'An HTTP server requires --url.' };
  if (usesUrl && command) return { error: 'Provide either --command (stdio) or --url (http), not both.' };
  if (!usesUrl && !command) return { error: 'Provide --command for a stdio server or --url for an http server.' };

  return {
    server: {
      id,
      command: usesUrl ? '' : command,
      transport: usesUrl ? 'http' : 'stdio',
      enabled: true,
      args: serverArgs,
      ...(usesUrl ? { url } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(cwd ? { cwd } : {}),
    },
  };
};

const serverKind = (server: McpServerConfig): 'stdio' | 'http' =>
  server.transport === 'http' || server.transport === 'sse' ? 'http' : 'stdio';

const describeServer = (server: McpServerConfig): string => {
  const kind = serverKind(server);
  const target =
    kind === 'http' ? server.url ?? '' : `${server.command}${server.args?.length ? ` ${server.args.join(' ')}` : ''}`;
  return `${server.id}\t${kind}\t${server.enabled === false ? 'disabled' : 'enabled'}\t${target}`;
};

export const runMcpCommand = async (
  request: McpCommandRequest,
  projectRoot: string,
  io: McpCommandIo = defaultIo
): Promise<number> => {
  const config = await readMcpConfig(projectRoot);
  const servers: McpServerConfig[] = Array.isArray(config.servers) ? config.servers : [];

  if (request.action === 'list') {
    if (!servers.length) {
      io.out('No MCP servers configured.');
      return 0;
    }
    for (const server of servers) io.out(describeServer(server));
    return 0;
  }

  if (request.action === 'add') {
    const parsed = parseServerArgs(request.args);
    if (!parsed.server) {
      io.err(parsed.error ?? 'Invalid server definition.');
      return 2;
    }
    const next = [...servers];
    const index = next.findIndex((entry) => entry.id === parsed.server!.id);
    if (index >= 0) next[index] = { ...next[index], ...parsed.server };
    else next.push(parsed.server);
    config.servers = next;
    await writeMcpConfig(projectRoot, config);
    io.out(`${index >= 0 ? 'Updated' : 'Added'} MCP server ${parsed.server.id}.`);
    return 0;
  }

  if (request.action === 'remove') {
    const id = request.args[0];
    if (!id) {
      io.err('Usage: jamcli mcp remove <id>');
      return 2;
    }
    if (!servers.some((entry) => entry.id === id)) {
      io.err(`No MCP server named ${id}.`);
      return 1;
    }
    config.servers = servers.filter((entry) => entry.id !== id);
    await writeMcpConfig(projectRoot, config);
    io.out(`Removed MCP server ${id}.`);
    return 0;
  }

  const id = request.args[0];
  if (!id) {
    io.err('Usage: jamcli mcp test <id>');
    return 2;
  }
  const server = servers.find((entry) => entry.id === id);
  if (!server) {
    io.err(`No MCP server named ${id}.`);
    return 1;
  }
  const result = await new McpTestService().testServer(server, projectRoot);
  io.out(`${result.status}: ${result.message}`);
  return result.status === 'ok' ? 0 : 1;
};
