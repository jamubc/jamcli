import type { ModelFacts, ModelPrice } from './types.js';

/**
 * One model's entry, as the `models` configuration block and the bundled table both write
 * it: snake_case keys, prices in US dollars per million tokens.
 */
const FIELDS: Record<string, keyof ModelFacts> = {
  context_window: 'contextWindow',
  max_output: 'maxOutput',
  tools: 'tools',
  reasoning: 'reasoning',
  images: 'images',
  thinking: 'thinking',
  always_thinks: 'alwaysThinks',
  effort: 'effort',
  price: 'price',
};

const PRICE_FIELDS: Record<string, keyof ModelPrice> = {
  input: 'input',
  output: 'output',
  cache_read: 'cacheRead',
  cache_write: 'cacheWrite',
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0;
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Parse one entry. A field that is wrong is left out and reported; the rest still apply. */
export function parseEntry(raw: unknown, where: string): { facts: ModelFacts; problems: string[] } {
  const facts: ModelFacts = {};
  const problems: string[] = [];
  if (!isObject(raw)) return { facts, problems: [`${where} must be an object; it is ignored.`] };

  for (const [key, value] of Object.entries(raw)) {
    const field = FIELDS[key];
    const at = `${where}.${key}`;
    if (!field) {
      problems.push(`${at} is not a model setting, so it has no effect. The settings are ${Object.keys(FIELDS).join(', ')}.`);
    } else if (field === 'contextWindow' || field === 'maxOutput') {
      if (count(value)) facts[field] = value as number;
      else problems.push(`${at} must be a whole number of tokens above zero; it is ignored.`);
    } else if (field === 'thinking') {
      if (value === 'adaptive' || value === 'budget') facts.thinking = value;
      else problems.push(`${at} must be "adaptive" or "budget"; it is ignored.`);
    } else if (field === 'price') {
      const price = parsePrice(value, at, problems);
      if (price) facts.price = price;
    } else if (typeof value === 'boolean') {
      facts[field] = value;
    } else {
      problems.push(`${at} must be true or false; it is ignored.`);
    }
  }
  return { facts, problems };
}

function parsePrice(raw: unknown, where: string, problems: string[]): ModelPrice | undefined {
  if (!isObject(raw)) {
    problems.push(`${where} must be an object with input and output prices; it is ignored.`);
    return undefined;
  }
  const price: Partial<ModelPrice> = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = PRICE_FIELDS[key];
    if (!field) {
      problems.push(`${where}.${key} is not a price, so it has no effect. The prices are ${Object.keys(PRICE_FIELDS).join(', ')}.`);
    } else if (amount(value)) {
      price[field] = value as number;
    } else {
      problems.push(`${where}.${key} must be a number of dollars per million tokens, zero or more; the price is ignored.`);
      return undefined;
    }
  }
  if (price.input === undefined || price.output === undefined) {
    problems.push(`${where} needs both input and output; the price is ignored.`);
    return undefined;
  }
  return price as ModelPrice;
}

/** Split `provider:model` at the first colon, so a model id with its own colon stays whole. */
export function splitModelKey(key: string): { provider: string; model: string } | undefined {
  const colon = key.indexOf(':');
  if (colon <= 0 || colon === key.length - 1) return undefined;
  return { provider: key.slice(0, colon), model: key.slice(colon + 1) };
}

/** Every entry of a `models` block, keyed `provider:model`, with what was wrong in it. */
export function parseModelsBlock(raw: unknown, where: string): { entries: Map<string, ModelFacts>; problems: string[] } {
  const entries = new Map<string, ModelFacts>();
  const problems: string[] = [];
  if (raw === undefined) return { entries, problems };
  if (!isObject(raw)) return { entries, problems: [`${where} must be an object keyed by provider:model; it is ignored.`] };
  for (const [key, value] of Object.entries(raw)) {
    const at = `${where}["${key}"]`;
    if (!splitModelKey(key)) {
      problems.push(`${at} must be named provider:model, such as "openai:gpt-5"; it is ignored.`);
      continue;
    }
    const parsed = parseEntry(value, at);
    problems.push(...parsed.problems);
    entries.set(key, parsed.facts);
  }
  return { entries, problems };
}
