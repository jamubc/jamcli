import type { CategoryChain, CategoryEntry } from '../../types/config.js';

export const DEFAULT_CATEGORIES: Record<string, CategoryChain> = {
  // These route delegated work when no `categories` block is configured. llama3 must be
  // pulled for them; on a machine without it the provider answers with its own
  // model-not-found error, which names llama3. Configure `categories` to route elsewhere.
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
