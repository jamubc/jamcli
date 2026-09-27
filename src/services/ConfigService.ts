import { ensureDir, pathExists, readJson, writeJson } from '../utils/fsx.js';
import path from 'path';
import { Config, ContextManagementConfig, GeneralConfig, McpConfig, ToolPermission } from '../types/config.js';
import type { McpServerConfig } from '../types/mcp.js';
import type { ToolName } from '../types/tools.js';
import { DEFAULT_CONFIG, DEFAULT_CONTEXT_MANAGEMENT, DEFAULT_MCP, JAMCLI_DIR, MCP_FILE } from './config/defaults.js';
import { toolPermissionsOf, upsertServer } from './config/mcpConfig.js';
import { ensureProjectStateDir } from '../core/transcript/log.js';
import { loadConfig } from '../core/config/load.js';

export class ConfigService {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  private get mcpPath() {
    return path.join(this.projectRoot, JAMCLI_DIR, MCP_FILE);
  }

  /** A project file's JSON object, or an empty one when the file is absent. */
  private async readProjectJson(file: string): Promise<Record<string, any>> {
    if (!(await pathExists(file))) return {};
    const value = await readJson(file);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  /** Write a project file, creating `.jamcli/` ignoring itself when this is the first thing stored there. */
  private async writeProjectJson(file: string, value: unknown): Promise<void> {
    ensureProjectStateDir(this.projectRoot);
    await ensureDir(path.dirname(file));
    await writeJson(file, value, { spaces: 2 });
  }

  /**
   * The configuration as sessions resolve it, from every layer, with the legacy
   * interface's defaults filled in. Reading writes nothing.
   */
  async getConfig(): Promise<Config> {
    return this.normalizeConfig(loadConfig({ projectRoot: this.projectRoot }).config);
  }

  /** The legacy `.jamcli/mcp.json`, with defaults for what it does not set. Reading writes nothing. */
  async getMcpConfig(): Promise<McpConfig> {
    const mcp = await this.readProjectJson(this.mcpPath);
    return { ...DEFAULT_MCP, ...mcp, servers: Array.isArray(mcp.servers) ? mcp.servers : [] } as McpConfig;
  }

  async getToolPermissions(): Promise<Record<ToolName, ToolPermission>> {
    const mcp = await this.getMcpConfig();
    return toolPermissionsOf(mcp);
  }

  async listMcpServers(): Promise<McpServerConfig[]> {
    const mcp = await this.getMcpConfig();
    return Array.isArray(mcp.servers) ? mcp.servers : [];
  }

  async upsertMcpServer(server: McpServerConfig): Promise<McpServerConfig[]> {
    const mcp = await this.readProjectJson(this.mcpPath);
    const servers = upsertServer(Array.isArray(mcp.servers) ? mcp.servers : [], server);
    mcp.servers = servers;
    await this.writeProjectJson(this.mcpPath, mcp);
    return servers;
  }

  async removeMcpServer(id: string): Promise<McpServerConfig[]> {
    const mcp = await this.readProjectJson(this.mcpPath);
    const servers = (Array.isArray(mcp.servers) ? (mcp.servers as McpServerConfig[]) : []).filter((server) => server.id !== id);
    mcp.servers = servers;
    await this.writeProjectJson(this.mcpPath, mcp);
    return servers;
  }

  private normalizeContextConfig(config?: Partial<ContextManagementConfig>): ContextManagementConfig {
    const base = { ...DEFAULT_CONTEXT_MANAGEMENT, ...config };
    const maxTokensNumber = Number(base.max_tokens);
    const max_tokens = Number.isFinite(maxTokensNumber) && maxTokensNumber > 0 ? Math.floor(maxTokensNumber) : DEFAULT_CONTEXT_MANAGEMENT.max_tokens;

    const thresholdNumber = Number(base.compression_threshold);
    const compression_threshold = Number.isFinite(thresholdNumber)
      ? Math.min(Math.max(thresholdNumber, 0.5), 1)
      : DEFAULT_CONTEXT_MANAGEMENT.compression_threshold;

    const strategy: ContextManagementConfig['strategy'] = base.strategy === 'truncate' ? 'truncate' : 'summarize';

    return {
      enabled: Boolean(base.enabled),
      max_tokens,
      compression_threshold,
      strategy,
    };
  }

  private normalizeGeneralConfig(config?: Partial<GeneralConfig>): GeneralConfig {
    return {
      show_tool_calling_models_only: Boolean(config?.show_tool_calling_models_only),
    };
  }

  private normalizeConfig(config: Config): Config {
    const normalized: Config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    const registry = config.api_registry ?? DEFAULT_CONFIG.api_registry;
    normalized.api_registry = { ...registry };

    normalized.context_management = this.normalizeContextConfig(config.context_management);
    normalized.general = this.normalizeGeneralConfig(config.general);
    normalized.telemetry = Boolean(config.telemetry);
    normalized.active_profile = config.active_profile || DEFAULT_CONFIG.active_profile;

    return normalized;
  }
}
