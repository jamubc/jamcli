import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  Config,
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
import { ALL_TOOL_NAMES, TOOL_DEFINITIONS } from '../types/tools.js';

const JAMCLI_DIR = '.jamcli';
const CONFIG_FILE = 'config.json';
const MCP_FILE = 'mcp.json';
const PROFILES_DIR = 'profiles';
const GLOBAL_DIR = '.jamubc';
const UI_CONFIG_FILE = 'ui.json';
const STATUS_STYLES_DIR = 'status-styles';

const TOOL_DEFAULTS = Object.fromEntries(
  ALL_TOOL_NAMES.map((name) => [
    name,
    {
      allowed: TOOL_DEFINITIONS[name].defaultAllowed,
      require_approval: TOOL_DEFINITIONS[name].defaultRequireApproval ?? false,
    } satisfies ToolPermission,
  ])
) as Record<ToolName, ToolPermission>;

const DEFAULT_CONFIG: Config = {
  api_registry: {
    ollama: { endpoint: 'http://localhost:11434' },
  },
  active_profile: 'default',
  telemetry: false,
};

const DEFAULT_UI_CONFIG: UiConfig = {
  status_indicator_style: 'subtle',
  status_text_style: 'subtle',
  status_spinner_style: 'classic',
  custom_status_styles: {},
};

const DEFAULT_MCP: McpConfig = {
  context_window_limit: 16000,
  ignore_patterns: ['node_modules/**', 'dist/**', '*.lock'],
  tools: {
    ...TOOL_DEFAULTS,
    git_ops: true,
  },
  servers: [],
};

const DEFAULT_PROFILE: Profile = {
  name: 'Default',
  system_prompt_override: 'You are a helpful AI assistant.',
  preferred_model: 'gpt-4o',
  temperature: 0.7,
};

type ProviderName = 'ollama' | 'openrouter';

export class ConfigService {
  private projectRoot: string;

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
    return fs.readJson(this.configPath);
  }

  async initializeUiConfig() {
    await fs.ensureDir(this.globalDir);
    await fs.ensureDir(this.statusStylesDir);
    if (!(await fs.pathExists(this.uiConfigPath))) {
      await fs.writeJson(this.uiConfigPath, DEFAULT_UI_CONFIG, { spaces: 2 });
    }
  }

  async getUiConfig(): Promise<UiConfig> {
    await this.initializeUiConfig();
    return fs.readJson(this.uiConfigPath);
  }

  async updateUiConfig(partial: Partial<UiConfig>): Promise<UiConfig> {
    const current = await this.getUiConfig();
    const updated: UiConfig = { ...DEFAULT_UI_CONFIG, ...current, ...partial };
    await fs.writeJson(this.uiConfigPath, updated, { spaces: 2 });
    return updated;
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
    const current = await this.getUiConfig();
    const custom = { ...(current.custom_status_styles || {}) };
    custom[name] = { path: definitionPath };
    return this.updateUiConfig({ custom_status_styles: custom });
  }

  getStatusStylesDirectory(): string {
    return this.statusStylesDir;
  }

  getCustomStatusStylePath(name: string) {
    return path.join(this.statusStylesDir, `${name}.json`);
  }

  async ensureCustomStatusStyle(name: string, template: StatusIndicatorCustomDefinition) {
    await this.initializeUiConfig();
    const targetPath = this.getCustomStatusStylePath(name);
    if (!(await fs.pathExists(targetPath))) {
      await fs.writeJson(targetPath, template, { spaces: 2 });
    }
    const uiConfig = await this.registerCustomStatusStyle(name, targetPath);
    return { path: targetPath, uiConfig };
  }

  async saveConfig(config: Config): Promise<void> {
    await fs.writeJson(this.configPath, config, { spaces: 2 });
  }

  async getMcpConfig(): Promise<McpConfig> {
    const mcp = await fs.readJson(this.mcpPath);
    if (!Array.isArray(mcp.servers)) {
      mcp.servers = [];
    }
    return mcp;
  }

  async getProfile(profileName: string): Promise<Profile> {
    const profilePath = path.join(this.profilesDir, `${profileName}.json`);
    if (await fs.pathExists(profilePath)) {
      return fs.readJson(profilePath);
    }
    return DEFAULT_PROFILE;
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
    const permissions = {} as Record<ToolName, ToolPermission>;
    for (const toolName of ALL_TOOL_NAMES) {
      permissions[toolName] = this.normalizePermission(
        mcp.tools?.[toolName] as ToolPermissionValue | undefined,
        TOOL_DEFAULTS[toolName]
      );
    }
    return permissions;
  }

  async updateToolPermission(toolName: ToolName, updates: Partial<ToolPermission>): Promise<ToolPermission> {
    const mcp = await this.getMcpConfig();
    mcp.tools = mcp.tools || {};
    const current = this.normalizePermission(mcp.tools[toolName] as ToolPermissionValue | undefined, TOOL_DEFAULTS[toolName]);
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
    const servers = Array.isArray(mcp.servers) ? [...mcp.servers] : [];
    const existingIndex = servers.findIndex((s) => s.id === server.id);
    if (existingIndex >= 0) {
      servers[existingIndex] = { ...servers[existingIndex], ...server };
    } else {
      servers.push({ ...server });
    }
    mcp.servers = servers;
    await fs.writeJson(this.mcpPath, mcp, { spaces: 2 });
    return servers;
  }

  async removeMcpServer(id: string): Promise<McpServerConfig[]> {
    const mcp = await this.getMcpConfig();
    const servers = Array.isArray(mcp.servers) ? mcp.servers.filter((s) => s.id !== id) : [];
    mcp.servers = servers;
    await fs.writeJson(this.mcpPath, mcp, { spaces: 2 });
    return servers;
  }

  private async updateActiveProfile(partial: Partial<Profile>): Promise<Profile> {
    const config = await this.getConfig();
    const profilePath = this.getActiveProfilePath(config.active_profile);
    const profile = (await fs.readJson(profilePath)) as Profile;
    const updated: Profile = { ...profile, ...partial };
    await fs.writeJson(profilePath, updated, { spaces: 2 });
    return updated;
  }

  private normalizePermission(value: ToolPermissionValue | undefined, defaults: ToolPermission): ToolPermission {
    if (typeof value === 'boolean') {
      return {
        allowed: value,
        require_approval: value ? defaults.require_approval ?? false : false,
      };
    }

    if (!value) {
      return { ...defaults };
    }

    return {
      allowed: value.allowed ?? defaults.allowed,
      require_approval: value.require_approval ?? defaults.require_approval ?? false,
      description: value.description ?? defaults.description,
    };
  }

  private async ensureToolDefaults() {
    try {
      const mcp = await this.getMcpConfig();
      mcp.tools = mcp.tools || {};
      let updated = false;

      for (const toolName of ALL_TOOL_NAMES) {
        const current = mcp.tools[toolName];
        const normalized = this.normalizePermission(current as ToolPermissionValue | undefined, TOOL_DEFAULTS[toolName]);
        const existingJson = JSON.stringify(current ?? null);
        const normalizedJson = JSON.stringify(normalized);
        if (existingJson !== normalizedJson) {
          mcp.tools[toolName] = normalized;
          updated = true;
        }
      }

      if (updated) {
        await fs.writeJson(this.mcpPath, mcp, { spaces: 2 });
      }
    } catch (error) {
      console.error('Failed to ensure MCP tool defaults', error);
    }
  }
}
