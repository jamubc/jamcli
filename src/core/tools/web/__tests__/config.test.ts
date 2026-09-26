import { expect, test } from 'bun:test';
import { ConfigFileSchema } from '../../../config/schema.js';

test('a search provider block validates and a typo inside it is rejected', () => {
  const parsed = ConfigFileSchema.parse({
    model: 'ollama:x',
    active_profile: 'default',
    search: { providers: { langsearch: { key_env_var: 'LANGSEARCH_API_KEY' } } },
  });
  expect(parsed.search?.providers?.langsearch?.key_env_var).toBe('LANGSEARCH_API_KEY');
  expect(() =>
    ConfigFileSchema.parse({ model: 'ollama:x', active_profile: 'default', search: { provider: {} } })
  ).toThrow();
});
