import type { ApiRegistry, CategoryChain } from '../../types/config.js';
import { getChain } from './categories.js';
import { downgradeReasoning, providerConfigured, providerOf } from './capabilities.js';
import type { ReasoningLevel } from './capabilities.js';

export interface RouteResolution {
  category: string;
  model: string | null;
  reasoning?: ReasoningLevel;
  skipped: { model: string; reason: string }[];
  notes: string[];
}

export interface ResolveOptions {
  registry: ApiRegistry | undefined;
  categories: Record<string, CategoryChain> | undefined;
  category: string;
  isReachable?: (model: string) => Promise<boolean>;
}

export const resolveRoute = async ({
  registry,
  categories,
  category,
  isReachable,
}: ResolveOptions): Promise<RouteResolution | null> => {
  const chain = getChain(categories, category);
  if (!chain) return null;

  const skipped: { model: string; reason: string }[] = [];
  const notes: string[] = [];

  for (const entry of chain) {
    const provider = providerOf(entry.model);
    if (!providerConfigured(registry, provider)) {
      skipped.push({ model: entry.model, reason: `provider ${provider} is not configured` });
      continue;
    }

    if (isReachable) {
      let reachable = false;
      try {
        reachable = await isReachable(entry.model);
      } catch {
        reachable = false;
      }
      if (!reachable) {
        skipped.push({ model: entry.model, reason: 'model could not be reached' });
        continue;
      }
    }

    const reasoning = downgradeReasoning(entry.reasoning, entry.model);
    if (reasoning.note) notes.push(reasoning.note);

    return { category, model: entry.model, reasoning: reasoning.level, skipped, notes };
  }

  return {
    category,
    model: null,
    skipped,
    notes: [...notes, `no entry in "${category}" is currently servable`],
  };
};
