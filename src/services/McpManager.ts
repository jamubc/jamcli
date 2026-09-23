import { ConfigService } from './ConfigService.js';
import type { McpServerConfig, McpToolDescriptor } from '../types/mcp.js';
import { listTools } from '../core/tools/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

type McpManagerOptions = {
  configService?: ConfigService;
};

/** The shape cached per connected server. */
type McpConnection = {
  server: McpServerConfig;
  client: Client;
  transport: Transport;
  tools?: McpToolDescriptor[];
};

/** Optional seams used by tests to avoid a live server. */
export interface McpTransportOverrides {
  fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
}

/**
 * Resolve which transport a server entry uses. stdio stays the default when
 * nothing is declared, so an entry with only a command behaves as it always
 * has. A URL-only entry is treated as HTTP even when the field is absent.
 */
export const resolveTransportKind = (server: McpServerConfig): 'stdio' | 'http' => {
  if (server.transport === 'http' || server.transport === 'sse') return 'http';
  if (!server.transport && !!server.url && !server.command) return 'http';
  return 'stdio';
};

const buildStdioEnv = (extra?: Record<string, string>): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  return { ...env, ...(extra || {}) };
};

/**
 * Build the SDK transport for a server entry. Exported so the transport choice
 * can be exercised without spawning a process or opening a socket.
 */
export const createClientTransport = (
  server: McpServerConfig,
  overrides: McpTransportOverrides = {}
): Transport => {
  const kind = resolveTransportKind(server);
  if (kind === 'http') {
    if (!server.url) {
      throw new Error(`MCP server ${server.id} declares an HTTP transport without a url.`);
    }
    return new StreamableHTTPClientTransport(new URL(server.url), {
      ...(server.headers ? { requestInit: { headers: server.headers } } : {}),
      ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    });
  }

  return new StdioClientTransport({
    command: server.command,
    args: server.args || [],
    env: buildStdioEnv(server.env),
    cwd: server.cwd || process.cwd(),
  });
};

export class McpManager {
  private configService: ConfigService;
  private connections: Map<string, McpConnection> = new Map();
  private toolIndex: Map<string, McpToolDescriptor> = new Map();

  constructor(options: McpManagerOptions = {}) {
    this.configService = options.configService || new ConfigService();
  }

  async listServers(): Promise<McpServerConfig[]> {
    return this.configService.listMcpServers();
  }

  async upsertServer(server: McpServerConfig): Promise<McpServerConfig[]> {
    if (!server.id) {
      throw new Error('MCP server requires at least an id.');
    }
    const kind = resolveTransportKind(server);
    if (kind === 'http' && !server.url) {
      throw new Error('An HTTP MCP server requires a url.');
    }
    if (kind === 'stdio' && !server.command) {
      throw new Error('A stdio MCP server requires a command.');
    }
    return this.configService.upsertMcpServer({
      enabled: true,
      args: [],
      ...server,
      transport: kind === 'http' ? 'http' : 'stdio',
    });
  }

  async removeServer(id: string): Promise<McpServerConfig[]> {
    return this.configService.removeMcpServer(id);
  }

  /**
   * Return MCP-style tool descriptors for built-in tools so they flow through the same pipeline.
   */
  getBuiltinTools(): McpToolDescriptor[] {
    // Built-in descriptors come from the registry so discovery sees the real
    // schemas declared by each tool rather than a permissive placeholder.
    const core = listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      source: 'builtin' as const,
    }));

    const searchTool: McpToolDescriptor = {
      name: 'search_tools',
      description: 'Search available MCP tools by keyword and description to discover capabilities on demand.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search terms or partial tool name' },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
        required: ['query'],
      },
      source: 'builtin',
    };

    return [...core, searchTool];
  }

  /**
   * Discover tools from all configured MCP servers and include built-ins.
   */
  async listAllTools(options: { refresh?: boolean } = {}): Promise<McpToolDescriptor[]> {
    const builtin = this.getBuiltinTools();
    const servers = await this.listServers();
    const enabledServers = servers.filter((srv) => srv.enabled !== false);
    const discovered: McpToolDescriptor[] = [];

    for (const server of enabledServers) {
      try {
        const tools = await this.listServerTools(server, { refresh: options.refresh });
        discovered.push(...tools);
      } catch (error) {
        // A server that fails to connect is reported as configured but not
        // connected, and the remaining servers still contribute tools.
        console.error(`Failed to list tools for MCP server ${server.id}`, error);
      }
    }

    return [...builtin, ...discovered];
  }

  async callServerTool(descriptor: McpToolDescriptor, args: Record<string, any>): Promise<{ output: string; raw?: any }> {
    if (!descriptor.serverId) {
      throw new Error('MCP tool is missing server id');
    }
    const server = (await this.listServers()).find((srv) => srv.id === descriptor.serverId);
    if (!server) {
      throw new Error(`MCP server not found for tool ${descriptor.name}`);
    }

    const connection = await this.getConnection(server);
    const result = await connection.client.callTool({
      name: descriptor.nativeName || descriptor.name,
      arguments: args || {},
    });

    const output = this.formatToolContent(result?.content);
    return { output, raw: result };
  }

  async listServerTools(server: McpServerConfig, opts: { refresh?: boolean } = {}): Promise<McpToolDescriptor[]> {
    const connection = await this.getConnection(server);
    if (!connection) return [];

    if (connection.tools && !opts.refresh) {
      return connection.tools;
    }

    const response = await connection.client.listTools();
    const tools = (response?.tools || []).map((tool) => this.mapToolDescriptor(server, tool));
    connection.tools = tools;

    for (const tool of tools) {
      this.toolIndex.set(tool.name, tool);
    }

    return tools;
  }

  async describeServers(): Promise<string> {
    const servers = await this.listServers();
    if (!servers.length) {
      return 'No MCP servers configured.';
    }

    const lines = servers.map((srv, idx) => {
      const status = srv.enabled === false ? 'disabled' : 'enabled';
      const kind = resolveTransportKind(srv);
      const target =
        kind === 'http'
          ? `url: ${srv.url}`
          : `cmd: ${srv.command}${srv.args?.length ? ` ${srv.args.join(' ')}` : ''}${srv.cwd ? `\n   cwd: ${srv.cwd}` : ''}`;
      return `${idx + 1}. ${srv.id} (${status}, ${kind})\n   ${target}`;
    });

    return ['MCP servers:', ...lines].join('\n');
  }

  async describeTools(): Promise<string> {
    const tools = await this.listAllTools();
    if (!tools.length) return 'No MCP tools available.';
    const lines = tools.map((tool, idx) => {
      const from = tool.source === 'server' ? `server:${tool.serverId}` : 'builtin';
      const original = tool.nativeName && tool.nativeName !== tool.name ? ` (native: ${tool.nativeName})` : '';
      return `${idx + 1}. ${tool.name} [${from}]${original} - ${tool.description || 'No description'}`;
    });
    return ['Available MCP tools:', ...lines].join('\n');
  }

  private buildServerToolName(serverId: string, toolName: string) {
    const normalized = toolName.replace(/[^a-zA-Z0-9_-]+/g, '_');
    return `${serverId}__${normalized}`;
  }

  async searchTools(query: string, limit: number = 20): Promise<McpToolDescriptor[]> {
    const all = await this.listAllTools();
    const needle = query.toLowerCase();
    const matches = all
      .filter((tool) => {
        const haystack = `${tool.name} ${tool.description || ''}`.toLowerCase();
        return haystack.includes(needle);
      })
      .slice(0, limit);
    return matches;
  }

  private async getConnection(server: McpServerConfig): Promise<McpConnection> {
    const existing = this.connections.get(server.id);
    if (existing) return existing;

    const transport = createClientTransport(server);

    const client = new Client(
      {
        name: 'jamcli',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    await client.connect(transport);
    const connection: McpConnection = { server, client, transport };
    this.connections.set(server.id, connection);
    return connection;
  }

  private mapToolDescriptor(server: McpServerConfig, tool: any): McpToolDescriptor {
    const name = this.buildServerToolName(server.id, tool.name || tool.title || 'tool');
    return {
      name,
      nativeName: tool.name,
      description: tool.description || tool.title,
      inputSchema: tool.inputSchema || tool.input_schema || { type: 'object', properties: {}, additionalProperties: true },
      source: 'server',
      serverId: server.id,
      serverTitle: server.title,
      annotations: tool.annotations,
    };
  }

  private formatToolContent(content: any): string {
    if (!content) return '<empty>';
    if (Array.isArray(content)) {
      return content
        .map((entry: any) => {
          if (entry?.type === 'text' && typeof entry.text === 'string') {
            return entry.text;
          }
          if (typeof entry === 'string') return entry;
          return JSON.stringify(entry);
        })
        .join('\n');
    }
    if (typeof content === 'string') return content;
    return JSON.stringify(content);
  }
}
