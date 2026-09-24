import fs from 'fs';
import { ensureDir, pathExists, readJson, writeJson } from '../utils/fsx.js';
import path from 'path';
import os from 'os';
import {
  Config,
  ContextManagementConfig,
  GeneralConfig,
  McpConfig,
  ModelInfo,
  Profile,
  ToolPermission,
  ToolPermissionValue,
  UiConfig,
  StatusIndicatorStyleId,
  StatusIndicatorCustomDefinition,
  StatusIndicatorStyleRef,
  StatusTextStyleId,
  StatusSpinnerStyleId,
} from '../types/config.js';
import type { McpServerConfig } from '../types/mcp.js';
import type { ToolName } from '../types/tools.js';
import { ALL_TOOL_NAMES } from '../types/tools.js';
import {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  DEFAULT_CONTEXT_MANAGEMENT,
  DEFAULT_MCP,
  DEFAULT_UI_CONFIG,
  GLOBAL_DIR,
  JAMCLI_DIR,
  MCP_FILE,
  PROFILES_DIR,
  STATUS_STYLES_DIR,
  TOOL_DEFAULTS,
  UI_CONFIG_FILE,
} from './config/defaults.js';
import type { ProviderName } from './config/defaults.js';
import { normalizePermission, toolPermissionsOf, upsertServer } from './config/mcpConfig.js';
import { ensureProjectStateDir } from '../core/transcript/log.js';
import { loadConfig } from '../core/config/load.js';
import { readProfile, writeProfile } from './config/profileConfig.js';
import {
  customStatusStylePath,
  ensureCustomStatusStyle,
  readUiConfig,
  registerCustomStatusStyle,
  writeUiConfig,
} from './config/uiConfig.js';

export class ConfigService {
  private projectRoot: string;

  private get uiPaths() {
    return {
      uiConfigPath: this.uiConfigPath,
      statusStylesDir: this.statusStylesDir,
      globalDir: this.globalDir,
    };
  }

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  private get jamDir() {
    return path.join(this.projectRoot, JAMCLI_DIR);
  }

  private get globalDir() {
    return path.join(os.homedir(), GLOBAL_DIR);
  }

  private get statusStylesDir() {
    return path.join(this.globalDir, STATUS_STYLES_DIR);
  }

  private get configPath() {
    return path.join(this.jamDir, CONFIG_FILE);
  }

  private get mcpPath() {
    return path.join(this.jamDir, MCP_FILE);
  }

  private get profilesDir() {
    return path.join(this.jamDir, PROFILES_DIR);
  }

  private get uiConfigPath() {
    return path.join(this.globalDir, UI_CONFIG_FILE);
  }

  private getActiveProfilePath(profileName: string) {
    return path.join(this.profilesDir, `${profileName}.json`);
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
   * Change the project's `.jamcli/config.json` and nothing else: what the user's file or
   * the defaults supply is never copied into it.
   */
  async updateProjectConfig(change: (config: Record<string, any>) => void): Promise<Config> {
    const config = await this.readProjectJson(this.configPath);
    change(config);
    await this.writeProjectJson(this.configPath, config);
    return this.getConfig();
  }

  /**
   * The configuration as sessions resolve it, from every layer, with the legacy
   * interface's defaults filled in. Reading writes nothing.
   */
  async getConfig(): Promise<Config> {
    return this.normalizeConfig(loadConfig({ projectRoot: this.projectRoot }).config);
  }

  async getUiConfig(): Promise<UiConfig> {
    return readUiConfig(this.uiPaths);
  }

  async updateUiConfig(partial: Partial<UiConfig>): Promise<UiConfig> {
    return writeUiConfig(this.uiPaths, partial);
  }

  async setStatusIndicatorStyle(styleId: StatusIndicatorStyleId): Promise<UiConfig> {
    // Back-compat: also update the split text/spinner fields
    return this.updateUiConfig({
      status_indicator_style: styleId,
      status_text_style: styleId as StatusTextStyleId,
      status_spinner_style: styleId as StatusSpinnerStyleId,
    });
  }

  async setStatusTextStyle(styleId: StatusTextStyleId): Promise<UiConfig> {
    return this.updateUiConfig({
      status_text_style: styleId,
      status_indicator_style: (styleId as StatusIndicatorStyleId) ?? 'subtle',
    });
  }

  async setStatusSpinnerStyle(styleId: StatusSpinnerStyleId): Promise<UiConfig> {
    return this.updateUiConfig({
      status_spinner_style: styleId,
    });
  }

  async registerCustomStatusStyle(name: string, definitionPath: string): Promise<UiConfig> {
    return registerCustomStatusStyle(this.uiPaths, name, definitionPath);
  }

  getStatusStylesDirectory(): string {
    return this.statusStylesDir;
  }

  getCustomStatusStylePath(name: string) {
    return customStatusStylePath(this.uiPaths, name);
  }

  async ensureCustomStatusStyle(name: string, template: StatusIndicatorCustomDefinition) {
    return ensureCustomStatusStyle(this.uiPaths, name, template);
  }

  /** The legacy `.jamcli/mcp.json`, with defaults for what it does not set. Reading writes nothing. */
  async getMcpConfig(): Promise<McpConfig> {
    const mcp = await this.readProjectJson(this.mcpPath);
    return { ...DEFAULT_MCP, ...mcp, servers: Array.isArray(mcp.servers) ? mcp.servers : [] } as McpConfig;
  }

  getMcpConfigPath(): string {
    return this.mcpPath;
  }

  async getProfile(profileName: string): Promise<Profile> {
    return readProfile(this.profilesDir, profileName);
  }

  /** The active profile, from the user's and the project's profile files, as sessions resolve it. */
  async getActiveProfile(): Promise<Profile> {
    return loadConfig({ projectRoot: this.projectRoot }).profile;
  }

  async updateSystemPrompt(systemPrompt: string): Promise<Profile> {
    return this.updateActiveProfile({ system_prompt_override: systemPrompt });
  }

  async updateProvider(provider: ProviderName, value?: string): Promise<Config> {
    if (provider !== 'ollama' && provider !== 'openrouter') throw new Error(`Provider ${provider} is not supported.`);
    if (provider === 'openrouter' && !value?.trim()) {
      throw new Error('Provide an API key: /config provider set openrouter <api_key>');
    }
    return this.updateProjectConfig((config) => {
      const registry = (config.api_registry ??= {});
      if (provider === 'ollama') registry.ollama = { endpoint: value?.trim() || 'http://localhost:11434' };
      else registry.openrouter = { api_key: value!.trim() };
    });
  }

  async removeProvider(provider: string): Promise<Config> {
    return this.updateProjectConfig((config) => {
      if (config.api_registry) delete config.api_registry[provider];
    });
  }

  /** Store a key in the project's configuration, as the legacy interface's provider menu does. */
  async setProviderKey(provider: 'openrouter' | 'openai' | 'anthropic', apiKey: string): Promise<Config> {
    return this.updateProjectConfig((config) => {
      (config.api_registry ??= {})[provider] = { api_key: apiKey };
    });
  }

  async updateContextManagement(updates: Partial<ContextManagementConfig>): Promise<Config> {
    return this.updateProjectConfig((config) => {
      config.context_management = this.normalizeContextConfig({ ...this.normalizeContextConfig(config.context_management), ...updates });
    });
  }

  async setTelemetry(enabled: boolean): Promise<Config> {
    return this.updateProjectConfig((config) => {
      config.telemetry = Boolean(enabled);
    });
  }

  async updateGeneralSettings(updates: Partial<GeneralConfig>): Promise<Config> {
    return this.updateProjectConfig((config) => {
      config.general = this.normalizeGeneralConfig({ ...this.normalizeGeneralConfig(config.general), ...updates });
    });
  }

  async configureOpenRouterProvider(options: {
    keyEnvVar: string;
    baseUrl?: string;
    referer?: string;
    title?: string;
  }): Promise<Config> {
    return this.updateProjectConfig((config) => {
      const registry = (config.api_registry ??= {});
      const next = { ...(registry.openrouter || {}), key_env_var: options.keyEnvVar, base_url: options.baseUrl, referer: options.referer, title: options.title };
      delete next.api_key;
      registry.openrouter = JSON.parse(JSON.stringify(next));
    });
  }

  async upsertCustomModel(model: ModelInfo): Promise<Config> {
    return this.updateProjectConfig((config) => {
      const existing: ModelInfo[] = Array.isArray(config.available_models) ? config.available_models : [];
      config.available_models = [...existing.filter((m) => m.id !== model.id), model];
    });
  }

  async getToolPermissions(): Promise<Record<ToolName, ToolPermission>> {
    const mcp = await this.getMcpConfig();
    return toolPermissionsOf(mcp);
  }

  async updateToolPermission(toolName: ToolName, updates: Partial<ToolPermission>): Promise<ToolPermission> {
    const mcp = await this.readProjectJson(this.mcpPath);
    mcp.tools = mcp.tools || {};
    const current = normalizePermission(mcp.tools[toolName] as ToolPermissionValue | undefined, TOOL_DEFAULTS[toolName]);
    const next: ToolPermission = {
      allowed: updates.allowed ?? current.allowed,
      require_approval: updates.require_approval ?? current.require_approval ?? false,
      description: updates.description ?? current.description,
    };
    mcp.tools[toolName] = next;
    await this.writeProjectJson(this.mcpPath, mcp);
    return next;
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

  private async updateActiveProfile(partial: Partial<Profile>): Promise<Profile> {
    const config = await this.getConfig();
    ensureProjectStateDir(this.projectRoot);
    return writeProfile(this.getActiveProfilePath(config.active_profile), partial);
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
