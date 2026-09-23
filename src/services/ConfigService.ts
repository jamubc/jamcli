import fs from 'fs-extra';
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
  DEFAULT_PROFILE,
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
import { normalizePermission, pendingToolDefaults, toolPermissionsOf, upsertServer } from './config/mcpConfig.js';
import { readProfile, writeProfile } from './config/profileConfig.js';
import {
  customStatusStylePath,
  ensureCustomStatusStyle,
  initializeUiConfig,
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

  async initialize() {
    await fs.ensureDir(this.jamDir);
    await fs.ensureDir(this.profilesDir);
    await fs.ensureDir(path.join(this.jamDir, 'history'));
    await this.initializeUiConfig();

    if (!(await fs.pathExists(this.configPath))) {
      await fs.writeJson(this.configPath, DEFAULT_CONFIG, { spaces: 2 });
    }

    if (!(await fs.pathExists(this.mcpPath))) {
      await fs.writeJson(this.mcpPath, DEFAULT_MCP, { spaces: 2 });
    }

    const defaultProfilePath = path.join(this.profilesDir, 'default.json');
    if (!(await fs.pathExists(defaultProfilePath))) {
      await fs.writeJson(defaultProfilePath, DEFAULT_PROFILE, { spaces: 2 });
    }

    await this.ensureToolDefaults();
  }

  async getConfig(): Promise<Config> {
    const raw = await fs.readJson(this.configPath);
    const normalized = this.normalizeConfig(raw);

    // Persist defaults if we filled any gaps
    const rawJson = JSON.stringify(raw);
    const normalizedJson = JSON.stringify(normalized);
    if (rawJson !== normalizedJson) {
      await fs.writeJson(this.configPath, normalized, { spaces: 2 });
    }

    return normalized;
  }

  async initializeUiConfig() {
    await initializeUiConfig(this.uiPaths);
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

  async saveConfig(config: Config): Promise<void> {
    const normalized = this.normalizeConfig(config);
    await fs.writeJson(this.configPath, normalized, { spaces: 2 });
  }

  async getMcpConfig(): Promise<McpConfig> {
    const mcp = await fs.readJson(this.mcpPath);
    if (!Array.isArray(mcp.servers)) {
      mcp.servers = [];
    }
    return mcp;
  }

  getMcpConfigPath(): string {
    return this.mcpPath;
  }

  async getProfile(profileName: string): Promise<Profile> {
    return readProfile(this.profilesDir, profileName);
  }

  async getActiveProfile(): Promise<Profile> {
    const config = await this.getConfig();
    return this.getProfile(config.active_profile);
  }

  async updateSystemPrompt(systemPrompt: string): Promise<Profile> {
    return this.updateActiveProfile({ system_prompt_override: systemPrompt });
  }

  async updateProvider(provider: ProviderName, value?: string): Promise<Config> {
    const config = await this.getConfig();
    switch (provider) {
      case 'ollama': {
        const endpoint = value && value.trim() ? value.trim() : 'http://localhost:11434';
        config.api_registry.ollama = { endpoint };
        break;
      }
      case 'openrouter': {
        if (!value || !value.trim()) {
          throw new Error('Provide an API key: /config provider set openrouter <api_key>');
        }
        config.api_registry.openrouter = { api_key: value.trim() };
        break;
      }
      default:
        throw new Error(`Provider ${provider} is not supported.`);
    }
    await fs.writeJson(this.configPath, config, { spaces: 2 });
    return config;
  }

  async removeProvider(provider: ProviderName): Promise<Config> {
    const config = await this.getConfig();
    delete config.api_registry[provider];
    await fs.writeJson(this.configPath, config, { spaces: 2 });
    return config;
  }

  async updateContextManagement(updates: Partial<ContextManagementConfig>): Promise<Config> {
    const config = await this.getConfig();
    const current = this.normalizeContextConfig(config.context_management);
    const next = this.normalizeContextConfig({ ...current, ...updates });
    config.context_management = next;
    await fs.writeJson(this.configPath, config, { spaces: 2 });
    return config;
  }

  async setTelemetry(enabled: boolean): Promise<Config> {
    const config = await this.getConfig();
    config.telemetry = Boolean(enabled);
    await fs.writeJson(this.configPath, config, { spaces: 2 });
    return config;
  }

  async updateGeneralSettings(updates: Partial<GeneralConfig>): Promise<Config> {
    const config = await this.getConfig();
    const current = this.normalizeGeneralConfig(config.general);
    config.general = this.normalizeGeneralConfig({ ...current, ...updates });
    await fs.writeJson(this.configPath, config, { spaces: 2 });
    return config;
  }

  async configureOpenRouterProvider(options: {
    keyEnvVar: string;
    baseUrl?: string;
    referer?: string;
    title?: string;
  }): Promise<Config> {
    const config = await this.getConfig();
    config.api_registry.openrouter = {
      ...(config.api_registry.openrouter || {}),
      key_env_var: options.keyEnvVar,
      base_url: options.baseUrl || undefined,
      referer: options.referer || undefined,
      title: options.title || undefined,
    };
    delete config.api_registry.openrouter?.api_key;
    await fs.writeJson(this.configPath, config, { spaces: 2 });
    return config;
  }

  async upsertCustomModel(model: ModelInfo): Promise<Config> {
    const config = await this.getConfig();
    const existing = config.available_models || [];
    const filtered = existing.filter((m) => m.id !== model.id);
    config.available_models = [...filtered, model];
    await fs.writeJson(this.configPath, config, { spaces: 2 });
    return config;
  }

  async getToolPermissions(): Promise<Record<ToolName, ToolPermission>> {
    const mcp = await this.getMcpConfig();
    return toolPermissionsOf(mcp);
  }

  async updateToolPermission(toolName: ToolName, updates: Partial<ToolPermission>): Promise<ToolPermission> {
    const mcp = await this.getMcpConfig();
    mcp.tools = mcp.tools || {};
    const current = normalizePermission(mcp.tools[toolName] as ToolPermissionValue | undefined, TOOL_DEFAULTS[toolName]);
    const next: ToolPermission = {
      allowed: updates.allowed ?? current.allowed,
      require_approval: updates.require_approval ?? current.require_approval ?? false,
      description: updates.description ?? current.description,
    };
    mcp.tools[toolName] = next;
    await fs.writeJson(this.mcpPath, mcp, { spaces: 2 });
    return next;
  }

  async listMcpServers(): Promise<McpServerConfig[]> {
    const mcp = await this.getMcpConfig();
    return Array.isArray(mcp.servers) ? mcp.servers : [];
  }

  async upsertMcpServer(server: McpServerConfig): Promise<McpServerConfig[]> {
    const mcp = await this.getMcpConfig();
    const servers = upsertServer(mcp.servers, server);
    mcp.servers = servers;
    await fs.writeJson(this.mcpPath, mcp, { spaces: 2 });
    return servers;
  }

  async removeMcpServer(id: string): Promise<McpServerConfig[]> {
    const mcp = await this.getMcpConfig();
    const servers = (Array.isArray(mcp.servers) ? mcp.servers : []).filter((server) => server.id !== id);
    mcp.servers = servers;
    await fs.writeJson(this.mcpPath, mcp, { spaces: 2 });
    return servers;
  }

  private async updateActiveProfile(partial: Partial<Profile>): Promise<Profile> {
    const config = await this.getConfig();
    const profilePath = this.getActiveProfilePath(config.active_profile);
    return writeProfile(profilePath, partial);
  }

  private async ensureToolDefaults() {
    try {
      const mcp = await this.getMcpConfig();
      const { tools, updated } = pendingToolDefaults(mcp.tools ?? {});
      mcp.tools = tools;
      if (updated) {
        await fs.writeJson(this.mcpPath, mcp, { spaces: 2 });
      }
    } catch (error) {
      console.error('Failed to ensure MCP tool defaults', error);
    }
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
