import { expect, test } from 'bun:test';
import { configuredSecrets, keyVariables } from '../../../runtime/model.js';

test('the search key value is scrubbed and its variable is withheld from subprocesses', () => {
  const search = { providers: { langsearch: { api_key: 'sk-search-123', key_env_var: 'LANGSEARCH_API_KEY' } } };
  const secrets = configuredSecrets(undefined, { LANGSEARCH_API_KEY: 'sk-search-123' }, search);
  expect(secrets).toContainEqual({ name: 'config:search.langsearch', value: 'sk-search-123' });
  expect(secrets).toContainEqual({ name: 'LANGSEARCH_API_KEY', value: 'sk-search-123' });
  expect(keyVariables(undefined, search)).toContain('LANGSEARCH_API_KEY');
});
