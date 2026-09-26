import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  canonicalizeUrl,
  containment,
  dedupeResults,
  SearchProviders,
  searchLangSearch,
  shingles,
  withDateline,
} from '../providers.js';
import type { SearchResult } from '../providers.js';

const realFetch = globalThis.fetch;
// The developer's own shell may export a real LANGSEARCH_API_KEY; scrub it before and
// after every test so a test's result never depends on that machine or on run order.
beforeEach(() => {
  delete process.env.LANGSEARCH_API_KEY;
  delete process.env.JAMCLI_LANGSEARCH_KEY;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.LANGSEARCH_API_KEY;
  delete process.env.JAMCLI_LANGSEARCH_KEY;
});

const payload = {
  data: {
    webPages: {
      value: [
        { url: 'https://a.example/x', name: 'A', text: 'alpha '.repeat(60), datePublished: '2018-09-16T07:08:14.000Z' },
        { url: 'https://a.example/x?utm_source=nl', name: 'A again', text: 'alpha '.repeat(60) },
        { url: 'https://print.example/x', name: '', snippet: 'short' },
        { name: 'missing url' },
      ],
    },
  },
};

test('the request is a POST with the bearer key, count, freshness, and contents.text', async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = (async (url: any, init: any) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  const results = await searchLangSearch('q', { apiKey: 'k', count: 999, freshness: 'oneWeek' });
  expect(seen!.url).toBe('https://api.langsearch.com/v1/web-search');
  expect(seen!.init.method).toBe('POST');
  expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer k');
  const body = JSON.parse(String(seen!.init.body));
  expect(body).toEqual({ query: 'q', count: 50, freshness: 'oneWeek', contents: { text: true } });
  expect(results.length).toBe(3);
  expect(results[0]).toMatchObject({ url: 'https://a.example/x', title: 'A' });
  expect(results[0].time.published).toBe(Date.parse('2018-09-16T07:08:14.000Z'));
  expect(results[1].title).toBe('A again');
  expect(results[2]).toMatchObject({ title: 'https://print.example/x', content: 'short', time: {} });
});

test('a non-2xx response throws with the status and the body head', async () => {
  globalThis.fetch = (async () => new Response('denied', { status: 401 })) as unknown as typeof fetch;
  await expect(searchLangSearch('q', { apiKey: 'k' })).rejects.toThrow('LangSearch request failed: HTTP 401 denied');
});

test('a 200 response that is not JSON throws a readable error', async () => {
  globalThis.fetch = (async () => new Response('<html>nope</html>', { status: 200 })) as unknown as typeof fetch;
  await expect(searchLangSearch('q', { apiKey: 'k' })).rejects.toThrow('LangSearch returned a body that is not JSON.');
});

test('canonicalizeUrl collapses tracking, print, amp, slash, and www variants', () => {
  expect(canonicalizeUrl('https://www.a.example/x/?utm_source=nl#top')).toBe('a.example/x');
  expect(canonicalizeUrl('https://a.example/x/print')).toBe('a.example/x');
  expect(canonicalizeUrl('https://a.example/x/index.html')).toBe('a.example/x');
});

test('dedupe drops the same page and near-identical text, keeps distinct results', () => {
  const body = 'the quick brown fox jumps over the lazy dog again and again and again';
  const results: SearchResult[] = [
    { url: 'https://a.example/x', content: body, time: {} },
    { url: 'https://a.example/x?utm_source=nl', content: body, time: {} },
    { url: 'https://b.example/mirror', content: body, time: {} },
    { url: 'https://c.example/other', content: 'entirely different words about a different subject with nothing shared', time: {} },
  ];
  expect(dedupeResults(results).map((result) => result.url)).toEqual(['https://a.example/x', 'https://c.example/other']);
});

test('withDateline stamps a date once and never double-stamps', () => {
  const stamped = withDateline([{ url: 'https://a.example', content: 'body', time: { published: Date.parse('2018-09-16T07:08:14Z') } }]);
  expect(stamped[0].content).toBe('Published: 2018-09-16\n\nbody');
  expect(withDateline(stamped)[0].content).toBe('Published: 2018-09-16\n\nbody');
  expect(withDateline([{ url: 'https://a.example', content: 'body', time: {} }])[0].content).toBe('body');
});

test('shingles and containment measure containment, not equality', () => {
  const a = shingles('one two three four five six seven');
  expect(containment(a, new Set(a))).toBe(1);
  expect(containment(a, new Set())).toBe(0);
});

test('available needs a key, host names the endpoint, and run composes dateline over dedupe', async () => {
  expect(new SearchProviders(undefined).available).toEqual([]);
  process.env.LANGSEARCH_API_KEY = 'env-key';
  const providers = new SearchProviders({ providers: { langsearch: { endpoint: 'https://search.example/api', api_key: 'file-key', key_env_var: 'JAMCLI_LANGSEARCH_KEY' } } });
  expect(providers.available).toEqual(['langsearch']);
  expect(providers.host).toBe('search.example');
  let seen: { url: string; auth?: string } = { url: '' };
  globalThis.fetch = (async (url: any, init: any) => {
    seen = { url: String(url), auth: init?.headers?.Authorization };
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  process.env.JAMCLI_LANGSEARCH_KEY = 'declared-key';
  const results = await providers.run('q');
  expect(seen.url).toBe('https://search.example/api');
  expect(seen.auth).toBe('Bearer declared-key'); // the declared variable beats the key in the file
  expect(results.length).toBe(2); // the two identical pages collapse to one
  expect(results[0].content!.startsWith('Published: 2018-09-16')).toBe(true);
});
