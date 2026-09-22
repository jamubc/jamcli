import { ConfigService } from './ConfigService.js';
import type { McpServerConfig, McpToolDescriptor } from '../types/mcp.js';
import { TOOL_DEFINITIONS, type ToolName } from '../types/tools.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

type McpManagerOptions = {
  configService?: ConfigService;
};

export class McpManager {
  private configService: ConfigService;
  private connections: Map<
    string,
    {
      server: McpServerConfig;
      client: Client;
      transport: StdioClientTransport;
      tools?: McpToolDescriptor[];
    }
  > = new Map();
  private toolIndex: Map<string, McpToolDescriptor> = new Map();

  constructor(options: McpManagerOptions = {}) {
    this.configService = options.configService || new ConfigService();
  }

  async listServers(): Promise<McpServerConfig[]> {
    return this.configService.listMcpServers();
  }

  async upsertServer(server: McpServerConfig): Promise<McpServerConfig[]> {
    if (!server.id || !server.command) {
      throw new Error('MCP server requires at least an id and command.');
    }
    return this.configService.upsertMcpServer({
      transport: 'stdio',
      enabled: true,
      args: [],
      ...server,
    });
  }

  async removeServer(id: string): Promise<McpServerConfig[]> {
    return this.configService.removeMcpServer(id);
  }

  /**
   * Return MCP-style tool descriptors for built-in tools so they flow through the same pipeline.
   */
  getBuiltinTools(): McpToolDescriptor[] {
    const names = Object.keys(TOOL_DEFINITIONS) as ToolName[];
    const core = names.map((name) => ({
      name,
      description: TOOL_DEFINITIONS[name].description,
      inputSchema: this.buildBuiltinSchema(name),
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
      const args = srv.args?.length ? ` ${srv.args.join(' ')}` : '';
      return `${idx + 1}. ${srv.id} (${status})\n   cmd: ${srv.command}${args}${srv.cwd ? `\n   cwd: ${srv.cwd}` : ''}`;
    });

    return ['MCP servers:', ...lines].join('\n');
  }

  async describeTools(): Promise<string> {
    const tools = await this.listAllTools();
    if (!tools.length) return 'No MCP tools available.';
    const lines = tools.map((tool, idx) => {
      const from = tool.source === 'server' ? `server:${tool.serverId}` : 'builtin';
      const original = tool.nativeName && tool.nativeName !== tool.name ? ` (native: ${tool.nativeName})` : '';
      return `${idx + 1}. ${tool.name} [${from}]${original} — ${tool.description || 'No description'}`;
    });
    return ['Available MCP tools:', ...lines].join('\n');
  }

  private buildBuiltinSchema(name: ToolName) {
    // Simple permissive schema for now; specific schemas can be added per tool.
    const base = {
      type: 'object',
      properties: {},
      additionalProperties: true,
    };

    if (name === 'list_files') {
      base.properties = {
        pattern: { type: 'string' },
        limit: { type: 'integer', minimum: 1 },
        include_hidden: { type: 'boolean' },
        include_dirs: { type: 'boolean' },
      };
    } else if (name === 'read_file') {
      base.properties = {
        path: { type: 'string' },
        start_line: { type: 'integer', minimum: 1 },
        end_line: { type: 'integer', minimum: 1 },
      };
    } else if (name === 'search_code') {
      base.properties = {
        query: { type: 'string' },
        regex: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            flags: { type: 'string' },
          },
        },
        pattern: { type: 'string' },
        limit: { type: 'integer', minimum: 1 },
        include_hidden: { type: 'boolean' },
      };
    } else if (name === 'run_command') {
      base.properties = {
        command: { type: 'string' },
        cwd: { type: 'string' },
      };
    } else if (name === 'apply_patch') {
      base.properties = {
        path: { type: 'string' },
        patch: { type: 'string' },
      };
    }

    return base;
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

  private async getConnection(server: McpServerConfig) {
    const existing = this.connections.get(server.id);
    if (existing) return existing;

    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args || [],
      env: { ...process.env, ...(server.env || {}) },
      cwd: server.cwd || process.cwd(),
      stdio: 'pipe',
    });

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
    const connection = { server, client, transport };
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
