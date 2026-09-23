import type { CategoryChain, CategoryEntry } from '../../types/config.js';

export const DEFAULT_CATEGORIES: Record<string, CategoryChain> = {
  quick: [{ model: 'ollama:llama3' }],
  explore: [{ model: 'ollama:llama3' }],
  deep: [{ model: 'ollama:llama3' }],
  writing: [{ model: 'ollama:llama3' }],
};

export const listCategories = (categories?: Record<string, CategoryChain>) =>
  Object.entries(categories ?? {}).map(([name, chain]) => ({ name, chain }));

export const getChain = (
  categories: Record<string, CategoryChain> | undefined,
  category: string
): CategoryChain | null => {
  if (!categories) return null;
  const chain = categories[category];
  if (!chain || chain.length === 0) return null;
  return chain;
};

export const describeChain = (chain: CategoryChain) =>
  chain
    .map((entry: CategoryEntry) => (entry.reasoning ? `${entry.model} (reasoning ${entry.reasoning})` : entry.model))
    .join(' -> ');
