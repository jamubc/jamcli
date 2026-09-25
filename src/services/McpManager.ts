import { ConfigService } from './ConfigService.js';
import type { McpServerConfig, McpToolDescriptor } from '../types/mcp.js';
import { listVisibleTools } from '../core/tools/index.js';
import { subprocessEnv } from '../core/sandbox/env.js';
import type { OAuthClientProvider, Transport } from '@modelcontextprotocol/client';
import { connectMcp, contentText, createTransport, transportKind, type ElicitationAnswer, type ElicitationRequest, type McpConnection } from '../core/mcp/connect.js';

type McpManagerOptions = {
  configService?: ConfigService;
  /** The environment a stdio server starts with. Defaults to JamCLI's, without credentials. */
  envFor?: (server: McpServerConfig) => Record<string, string>;
  /** Answers a server's request for input; declined when absent. */
  elicit?: (request: ElicitationRequest) => Promise<ElicitationAnswer>;
  /** How an HTTP server that asks for sign-in is signed in to, if it can be. */
  authFor?: (server: McpServerConfig) => OAuthClientProvider | undefined;
  /** Servers beyond the configured ones, such as those plugins bring. */
  extraServers?: McpServerConfig[];
};

/** A server's prompt, which becomes `/server:name`. */
export interface McpPromptDescriptor {
  serverId: string;
  name: string;
  description?: string;
  arguments: { name: string; description?: string; required?: boolean }[];
}

/** A server's resource, which becomes an `@server:uri` reference. */
export interface McpResourceDescriptor {
  serverId: string;
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** Optional seams used by tests to avoid a live server. */
export interface McpTransportOverrides {
  fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
}

/** stdio stays the default; an entry with only a URL is HTTP. */
export const resolveTransportKind = transportKind;

/** A server gets JamCLI's environment without credentials, plus what its entry declares. */
export const serverEnv = (server: McpServerConfig): Record<string, string> =>
  subprocessEnv(process.env, { passthrough: server.env_passthrough, extra: server.env });

/** Build the transport for a server entry, without starting it. */
export const createClientTransport = (
  server: McpServerConfig,
  overrides: McpTransportOverrides = {},
  env: Record<string, string> = serverEnv(server)
): Transport => createTransport(server, { env, ...(overrides.fetch ? { fetch: overrides.fetch } : {}) });

export class McpManager {
  private configService: ConfigService;
  private connections: Map<string, McpConnection & { tools?: McpToolDescriptor[] }> = new Map();
  private connecting: Map<string, Promise<McpConnection>> = new Map();
  private toolIndex: Map<string, McpToolDescriptor> = new Map();

  private envFor: (server: McpServerConfig) => Record<string, string>;

  constructor(private readonly options: McpManagerOptions = {}) {
    this.configService = options.configService || new ConfigService();
    this.envFor = options.envFor ?? serverEnv;
  }

  /** Which protocol revision each connected server speaks. */
  describeEras(): { id: string; era: 'modern' | 'legacy'; protocolVersion: string }[] {
    return [...this.connections.values()].map((connection) => ({ id: connection.server.id, era: connection.era, protocolVersion: connection.protocolVersion }));
  }

  async listServers(): Promise<McpServerConfig[]> {
    return [...(await this.configService.listMcpServers()), ...(this.options.extraServers ?? [])];
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
    const core = listVisibleTools().map((tool) => ({
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

  async callServerTool(descriptor: McpToolDescriptor, args: Record<string, any>): Promise<{ output: string; isError?: boolean; raw?: any }> {
    if (!descriptor.serverId) {
      throw new Error('MCP tool is missing server id');
    }
    const server = (await this.listServers()).find((srv) => srv.id === descriptor.serverId);
    if (!server) {
      throw new Error(`MCP server not found for tool ${descriptor.name}`);
    }

    const connection = await this.getConnection(server);
    const result: any = await connection.client.callTool({
      name: descriptor.nativeName || descriptor.name,
      arguments: args || {},
    });

    const output = contentText(result?.content);
    return { output: result?.isError ? `The server reported an error: ${output}` : output, ...(result?.isError ? { isError: true } : {}), raw: result };
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

  /** A server's prompts, or none when it offers no prompts. */
  async listServerPrompts(server: McpServerConfig): Promise<McpPromptDescriptor[]> {
    const connection = await this.getConnection(server);
    if (!connection.client.getServerCapabilities()?.prompts) return [];
    const { prompts } = await connection.client.listPrompts();
    return prompts.map((prompt: any) => ({ serverId: server.id, name: prompt.name, ...(prompt.description ? { description: prompt.description } : {}), arguments: prompt.arguments ?? [] }));
  }

  /** A prompt's messages as the text of one message to send. */
  async getServerPrompt(serverId: string, name: string, args: Record<string, string>): Promise<string> {
    const server = (await this.listServers()).find((entry) => entry.id === serverId);
    if (!server) throw new Error(`No MCP server ${serverId}.`);
    const connection = await this.getConnection(server);
    const result: any = await connection.client.getPrompt({ name, arguments: args });
    return (result.messages ?? []).map((message: any) => contentText([message.content])).join('\n\n');
  }

  /** A server's resources, or none when it offers no resources. */
  async listServerResources(server: McpServerConfig): Promise<McpResourceDescriptor[]> {
    const connection = await this.getConnection(server);
    if (!connection.client.getServerCapabilities()?.resources) return [];
    const { resources } = await connection.client.listResources();
    return resources.map((resource: any) => ({
      serverId: server.id,
      uri: resource.uri,
      name: resource.name ?? resource.uri,
      ...(resource.description ? { description: resource.description } : {}),
      ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
    }));
  }

  /** A resource's contents as text; binary parts are described, not included. */
  async readServerResource(serverId: string, uri: string): Promise<string> {
    const server = (await this.listServers()).find((entry) => entry.id === serverId);
    if (!server) throw new Error(`No MCP server ${serverId}.`);
    const connection = await this.getConnection(server);
    const result: any = await connection.client.readResource({ uri });
    return (result.contents ?? [])
      .map((part: any) => (typeof part.text === 'string' ? part.text : `[${part.mimeType ?? 'binary'} content of ${String(part.blob ?? '').length} bytes of base64]`))
      .join('\n');
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

  /** Close every open server connection, which stops stdio servers. */
  async close(): Promise<void> {
    const open = [...this.connections.values()];
    this.connections.clear();
    this.toolIndex.clear();
    await Promise.allSettled(open.map((connection) => connection.client.close()));
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

  /** One connection per server, shared by every caller, made once even when asked for together. */
  private async getConnection(server: McpServerConfig): Promise<McpConnection & { tools?: McpToolDescriptor[] }> {
    const existing = this.connections.get(server.id);
    if (existing) return existing;
    let pending = this.connecting.get(server.id);
    if (!pending) {
      const auth = this.options.authFor?.(server);
      pending = connectMcp(server, {
        env: this.envFor(server),
        ...(this.options.elicit ? { elicit: this.options.elicit } : {}),
        ...(auth ? { authProvider: auth } : {}),
      });
      this.connecting.set(server.id, pending);
    }
    try {
      const connection = await pending;
      this.connections.set(server.id, connection);
      return connection;
    } finally {
      this.connecting.delete(server.id);
    }
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
}
