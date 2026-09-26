import type { ApiRegistry } from '../../types/config.js';
import { providerOf } from './capabilities.js';
import { createChatProvider } from '../providers/factory.js';
import { isListableProvider } from '../providers/types.js';

/**
 * Ollama is the only provider a chain can name without configuring anything, so it is the
 * only one that can be "configured" yet not actually running. A chain that names it
 * deserves this check before a run spends a turn discovering the same thing itself;
 * without it, `resolveRoute`'s skip-and-report path never engages and every request in
 * the chain fails raw.
 */
export const isChainReachable = async (model: string, registry: ApiRegistry | undefined): Promise<boolean> => {
  if (providerOf(model) !== 'ollama') return true;
  const provider = createChatProvider('ollama', registry ?? {});
  if (!isListableProvider(provider)) return true;
  try {
    await provider.listModels();
    return true;
  } catch {
    return false;
  }
};
