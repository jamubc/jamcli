import fs from 'fs-extra';
import path from 'path';
import { ConfigService } from './ConfigService.js';
import { LLMFactory } from './LLMProvider.js';
import type { Config, ModelInfo, Profile } from '../types/config.js';

const OPENROUTER_CACHE_TTL = 1000 * 60 * 10; // 10 minutes

export class ModelService {
  private configService: ConfigService;
  private openRouterCache: { timestamp: number; models: ModelInfo[] } | null = null;

  constructor(configService: ConfigService) {
    this.configService = configService;
  }

  async listAvailableModels(): Promise<ModelInfo[]> {
    const config = await this.configService.getConfig();
    const models: ModelInfo[] = [];

    // List Ollama models
    if (config.api_registry.ollama) {
      try {
        const provider = LLMFactory.createProvider('ollama', config.api_registry.ollama);
        if (provider.listModels) {
          const ollamaModels = await provider.listModels();
          models.push(
            ...ollamaModels.map(name => ({
              id: `ollama:${name}`,
              provider: 'ollama' as const,
              name,
              description: `Ollama model: ${name}`
            }))
          );
        }
      } catch (e) {
        console.error('Failed to list Ollama models', e);
      }
    }

    if (config.api_registry.openrouter) {
      const openRouterModels = await this.fetchOpenRouterModels(config);
      const filteredOpenRouter = config.general?.show_tool_calling_models_only
        ? openRouterModels.filter((model) => model.supports_tool_calling)
        : openRouterModels;
      if (filteredOpenRouter.length > 0) {
        models.push(...filteredOpenRouter);
      }
    }

    if (config.available_models?.length) {
      models.push(...config.available_models);
    }

    const deduped: ModelInfo[] = [];
    const seen = new Set<string>();
    for (const model of models) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      deduped.push(model);
    }

    return deduped;
  }

  private async fetchOpenRouterModels(config: Config): Promise<ModelInfo[]> {
    const registry = config.api_registry.openrouter;
    if (!registry) {
      return [];
    }

    const now = Date.now();
    if (this.openRouterCache && now - this.openRouterCache.timestamp < OPENROUTER_CACHE_TTL) {
      return this.openRouterCache.models;
    }

    const apiKey = registry.api_key || process.env[registry.key_env_var || 'OPENROUTER_API_KEY'];
    if (!apiKey) {
      return [];
    }

    const baseUrl = registry.base_url?.replace(/\/$/, '') || 'https://openrouter.ai/api/v1';
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`OpenRouter responded with status ${response.status}`);
      }

      const json = await response.json();
      const data = Array.isArray(json.data) ? json.data : [];
      const mapped = data.map((model: any): ModelInfo => {
        const supportedParams = Array.isArray(model.supported_parameters)
          ? model.supported_parameters.map((param: string) => param.toLowerCase())
          : [];
        const supportsTools = supportedParams.includes('tools') || supportedParams.includes('tool_choice');
        return {
          id: `openrouter:${model.id}`,
          provider: 'openrouter',
          name: model.name || model.id,
          description: model.description || model.pricing?.prompt || 'OpenRouter model',
          supports_tool_calling: supportsTools,
        };
      });

      this.openRouterCache = { timestamp: now, models: mapped };
      return mapped;
    } catch (error) {
      console.error('Failed to fetch OpenRouter models', error);
      return [];
    }
  }

  async getCurrentModel(): Promise<{ provider: string; model: string } | null> {
    const profile = await this.configService.getActiveProfile();
    return {
      provider: profile.preferred_provider || 'ollama',
      model: profile.preferred_model || 'llama3'
    };
  }

  async switchModel(modelId: string): Promise<Profile> {
    const profile = await this.configService.getActiveProfile();

    let provider: Profile['preferred_provider'] = profile.preferred_provider || 'ollama';
    let model = modelId.trim();

    if (modelId.includes(':')) {
      const [providerPart, ...modelParts] = modelId.split(':');
      provider = (providerPart as Profile['preferred_provider']) || provider;
      model = modelParts.length > 0 ? modelParts.join(':') : profile.preferred_model || 'llama3';
    }

    profile.preferred_provider = provider;
    profile.preferred_model = model || profile.preferred_model || 'llama3';

    // Save updated profile
    const config = await this.configService.getConfig();
    const profilePath = path.join(this.configService['jamDir'], 'profiles', `${config.active_profile}.json`);
    await fs.writeJson(profilePath, profile, { spaces: 2 });

    return profile;
  }

  async addApiKey(provider: 'openrouter' | 'openai' | 'anthropic', apiKey: string): Promise<void> {
    const config = await this.configService.getConfig();
    
    if (provider === 'openrouter') {
      config.api_registry.openrouter = { api_key: apiKey };
    } else if (provider === 'openai') {
      config.api_registry.openai = { api_key: apiKey };
    } else if (provider === 'anthropic') {
      config.api_registry.anthropic = { api_key: apiKey };
    }

    await fs.writeJson(
      path.join(this.configService['projectRoot'], '.jamcli', 'config.json'),
      config,
      { spaces: 2 }
    );
  }

  async removeProvider(provider: 'openrouter' | 'openai' | 'anthropic'): Promise<void> {
    const config = await this.configService.getConfig();
    delete config.api_registry[provider];

    await fs.writeJson(
      path.join(this.configService['projectRoot'], '.jamcli', 'config.json'),
      config,
      { spaces: 2 }
    );
  }
}
