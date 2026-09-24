import fs from 'fs-extra';
import path from 'path';
import { ConfigService } from './ConfigService.js';
import { createChatProvider, listConfiguredProviders } from '../core/providers/factory.js';
import { isListableProvider, type ProviderModelInfo } from '../core/providers/types.js';
import type { ApiRegistry, Config, ModelInfo, Profile } from '../types/config.js';

const MODEL_CACHE_TTL = 1000 * 60 * 10; // 10 minutes

export type ModelOrigin = 'discovered' | 'configured';

/** A model the selector can offer, tagged with where JamCLI learned about it. */
export interface AvailableModel extends ModelInfo {
  origin: ModelOrigin;
  /** The provider id or custom endpoint id the model belongs to. */
  endpoint?: string;
}

export interface DiscoveryFailure {
  provider: string;
  message: string;
}

export interface DiscoveryResult {
  models: AvailableModel[];
  failures: DiscoveryFailure[];
}

export class ModelService {
  private configService: ConfigService;
  private modelCache = new Map<string, { timestamp: number; models: ProviderModelInfo[] }>();

  constructor(configService: ConfigService) {
    this.configService = configService;
  }

  clearModelCache(): void {
    this.modelCache.clear();
  }

  /**
   * Queries the models route for every configured endpoint and tags each result
   * with its origin. A failure for one provider is reported and does not stop
   * discovery for the others.
   */
  async discoverModels(): Promise<DiscoveryResult> {
    const config = await this.configService.getConfig();
    const registry = config.api_registry ?? {};
    const models: AvailableModel[] = [];
    const failures: DiscoveryFailure[] = [];

    for (const id of listConfiguredProviders(registry)) {
      try {
        const listed = await this.listProviderModels(id, registry);
        models.push(...listed.map((model) => toAvailableModel(model, id, registry)));
      } catch (error: any) {
        const message = error?.message || String(error);
        failures.push({ provider: id, message });
        console.error(`Failed to discover models for ${id}: ${message}`);
      }
    }

    return { models, failures };
  }

  async listAvailableModels(): Promise<AvailableModel[]> {
    const config = await this.configService.getConfig();
    const { models } = await this.discoverModels();

    const configured: AvailableModel[] = (config.available_models || []).map((model) => ({
      ...model,
      origin: 'configured',
    }));

    const merged = dedupeById([...models, ...configured]);

    if (config.general?.show_tool_calling_models_only) {
      return merged.filter(
        (model) => model.origin === 'configured' || model.supports_tool_calling !== false
      );
    }
    return merged;
  }

  private async listProviderModels(id: string, registry: ApiRegistry): Promise<ProviderModelInfo[]> {
    const now = Date.now();
    const cached = this.modelCache.get(id);
    if (cached && now - cached.timestamp < MODEL_CACHE_TTL) {
      return cached.models;
    }

    const provider = createChatProvider(id, registry);
    if (!isListableProvider(provider)) {
      throw new Error(`provider "${id}" does not expose a models route`);
    }
    const models = await provider.listModels();
    this.modelCache.set(id, { timestamp: now, models });
    return models;
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
    this.modelCache.clear();
    await this.configService.setProviderKey(provider, apiKey);
  }

  async removeProvider(provider: 'openrouter' | 'openai' | 'anthropic'): Promise<void> {
    this.modelCache.clear();
    await this.configService.removeProvider(provider);
  }
}

function dedupeById(models: AvailableModel[]): AvailableModel[] {
  const output: AvailableModel[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    output.push(model);
  }
  return output;
}

function providerLabel(id: string, registry: ApiRegistry): ModelInfo['provider'] {
  if (id === 'ollama' || id === 'openai' || id === 'anthropic' || id === 'openrouter') return id;
  const endpoint = registry.endpoints?.find((entry) => entry.id === id);
  return endpoint?.dialect === 'anthropic' ? 'anthropic' : 'openai';
}

function toAvailableModel(model: ProviderModelInfo, id: string, registry: ApiRegistry): AvailableModel {
  return {
    id: `${id}:${model.id}`,
    provider: providerLabel(id, registry),
    name: model.name || model.id,
    description: model.description || `Discovered from ${id}`,
    ...(model.supports_tool_calling !== undefined ? { supports_tool_calling: model.supports_tool_calling } : {}),
    origin: 'discovered',
    endpoint: id,
  };
}
