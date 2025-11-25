import { ConfigService } from './ConfigService.js';
import { ToolService } from './ToolService.js';
import type { McpServerConfig, McpToolDescriptor } from '../types/mcp.js';
import { TOOL_DEFINITIONS, type ToolName } from '../types/tools.js';

type McpManagerOptions = {
  configService?: ConfigService;
  toolService?: ToolService;
};

export class McpManager {
  private configService: ConfigService;
  private toolService: ToolService;

  constructor(options: McpManagerOptions = {}) {
    this.configService = options.configService || new ConfigService();
    this.toolService = options.toolService || new ToolService({ configService: this.configService });
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
    return names.map((name) => ({
      name,
      description: TOOL_DEFINITIONS[name].description,
      inputSchema: this.buildBuiltinSchema(name),
      source: 'builtin' as const,
    }));
  }

  /**
   * Placeholder for future server tool discovery. Currently returns only built-ins.
   */
  async listAllTools(): Promise<McpToolDescriptor[]> {
    const builtin = this.getBuiltinTools();
    // Future: merge server tools discovered via MCP connections.
    return builtin;
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
    const lines = tools.map((tool, idx) => `${idx + 1}. ${tool.name} [${tool.source}] — ${tool.description || 'No description'}`);
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
}
