import table from './catalog.json' with { type: 'json' };
import type { ProviderFamily } from '../providers/types.js';
import { parseModelsBlock } from './entries.js';
import type { ModelFacts } from './types.js';

/**
 * The table bundled with JamCLI: models whose limits and prices were checked against the
 * vendor's published documentation on the `verified` date. It is the third source, after
 * configuration and the provider's own metadata, so a stale row is corrected by either.
 */
const parsed = parseModelsBlock(table.models, 'catalog.json models');
const aliases: Record<string, string> = table.aliases;

export const BUNDLED_VERIFIED: string = table.verified;

/** Problems in the bundled table itself. A test keeps this empty. */
export const bundledProblems = (): string[] => [...parsed.problems];

/** Every `provider:model` the table has a row for, aliases excluded. */
export const bundledModels = (): string[] => [...parsed.entries.keys()];

const lookup = (key: string): ModelFacts | undefined => parsed.entries.get(aliases[key] ?? key);

/**
 * The bundled facts for a model. The provider's own row applies whole. Another endpoint
 * that speaks the Anthropic dialect, such as a gateway, serves the same models with the
 * same limits, so it gets the Anthropic row without its prices: that endpoint sets its own.
 */
export function bundledFacts(provider: string, model: string, family?: ProviderFamily): ModelFacts | undefined {
  const own = lookup(`${provider}:${model}`);
  if (own) return own;
  if (family !== 'anthropic' || provider === 'anthropic') return undefined;
  const row = lookup(`anthropic:${model}`);
  if (!row) return undefined;
  const { price: _price, ...limits } = row;
  return limits;
}
