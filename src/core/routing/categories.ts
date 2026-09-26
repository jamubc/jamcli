import type { CategoryChain, CategoryEntry } from '../../types/config.js';

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
