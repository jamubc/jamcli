import { expect, test } from 'bun:test';
import { refineFetch, refineSearch } from '../refine.js';
import type { SearchResult } from '../providers.js';

const ctx = { projectRoot: '/tmp' };

test('refineSearch returns the same results unchanged', async () => {
  const results: SearchResult[] = [{ url: 'https://a.example', title: 'A', content: 'body', time: {} }];
  expect(await refineSearch('q', results, ctx)).toBe(results);
});

test('refineFetch returns the same text unchanged, prompt or not', async () => {
  expect(await refineFetch('https://a.example', 'page text', undefined, ctx)).toBe('page text');
  expect(await refineFetch('https://a.example', 'page text', 'extract prices', ctx)).toBe('page text');
});
