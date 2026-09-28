import { expect, test } from 'bun:test';
import { refineFetch, refineSearch } from '../refine.js';
import type { SearchResult } from '../providers.js';

const ctx = { projectRoot: '/tmp' };

test('refineSearch returns the same results unchanged', async () => {
  const results: SearchResult[] = [{ url: 'https://a.example', title: 'A', content: 'body', time: {} }];
  expect(await refineSearch('q', results, ctx)).toBe(results);
});

test('a short page, or a fetch with no prompt, comes back whole', async () => {
  expect(await refineFetch('https://a.example', 'page text', undefined, ctx)).toBe('page text');
  expect(await refineFetch('https://a.example', 'page text', 'extract prices', ctx)).toBe('page text');
  const long = `https://a.example (200, text/html)\n\n${'filler sentence. '.repeat(1_200)}`;
  expect(await refineFetch('https://a.example', long, undefined, ctx)).toBe(long);
  // A prompt of only common words gives nothing to look for, so the page is not narrowed.
  expect(await refineFetch('https://a.example', long, 'what is the', ctx)).toBe(long);
});

test('a long page with a prompt keeps the paragraphs that mention it, in page order, and says how to get the rest', async () => {
  const filler = (n: number) => `Background paragraph ${n} about nothing in particular. ${'It rambles on. '.repeat(40)}`;
  const page = [
    'https://a.example/docs (200, text/html)',
    'Widget documentation: the overview.',
    ...Array.from({ length: 30 }, (_, n) => filler(n)),
    '## Rate limits\nThe rate limit is 600 requests per minute per key, and bursts above it return 429.',
    ...Array.from({ length: 30 }, (_, n) => filler(100 + n)),
    'Cache lifetimes: the cache keeps a page for fifteen minutes; the rate limit resets on the minute.',
  ].join('\n\n');
  expect(page.length).toBeGreaterThan(20_000);
  const out = await refineFetch('https://a.example/docs', page, 'What are the rate limit and cache lifetime?', ctx);
  expect(out.startsWith('https://a.example/docs (200, text/html)\n\nWidget documentation: the overview.')).toBe(true);
  expect(out).toContain('The rate limit is 600 requests per minute per key');
  expect(out).toContain('the cache keeps a page for fifteen minutes');
  expect(out.indexOf('600 requests')).toBeLessThan(out.indexOf('fifteen minutes'));
  expect(out).not.toContain('Background paragraph 3 ');
  expect(out.length).toBeLessThan(7_500);
  expect(out).toContain(`of ${page.length.toLocaleString('en-US')} characters: the parts that mention`);
  expect(out).toContain('Call web_fetch again without a prompt for the whole page.');
});

test('a long page that mentions nothing asked for comes back from its start, and says so', async () => {
  const page = `https://a.example (200, text/html)\n\n${'Nothing relevant here. '.repeat(1_500)}`;
  const out = await refineFetch('https://a.example', page, 'kubernetes operators', ctx);
  expect(out.length).toBeLessThan(6_600);
  expect(out).toContain('the start of the page, since nothing on it mentions "kubernetes operators"');
});
