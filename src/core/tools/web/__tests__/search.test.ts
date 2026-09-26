import { expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { webSearchWith } from '../index.js';
import type { SearchResult } from '../providers.js';
import { createRuntime } from '../../../runtime/index.js';
import { startFakeProvider } from '../../../../testing/fakeProvider.js';

const results: SearchResult[] = [
  { url: 'https://a.example/x', title: 'A', content: 'Published: 2018-09-16\n\nalpha', time: { published: 1 } },
  { url: 'https://b.example/y', title: 'B', content: 'beta', time: {} },
];

const runner = { available: ['langsearch'], run: async () => results };
const ctx = { projectRoot: '/tmp' };

test('results are rendered with title, URL, and text', async () => {
  const tool = webSearchWith(runner, async (_q, r) => r);
  const out = await tool.runner({ query: 'prices' }, ctx);
  expect(out.output).toContain('## A');
  expect(out.output).toContain('https://a.example/x');
  expect(out.output).toContain('alpha');
});

test('a provider failure is reported in the result and the session continues', async () => {
  const failing = { available: ['langsearch'], run: async () => { throw new Error('LangSearch request failed: HTTP 500 boom'); } };
  const out = await webSearchWith(failing, async (_q, r) => r).runner({ query: 'q' }, ctx);
  expect(out.output).toContain('Search failed: LangSearch request failed: HTTP 500 boom');
});

test('the refine stage sees the query and results, and its output is what returns', async () => {
  const tool = webSearchWith(runner, async (query, r) => [{ ...r[0], content: `refined for ${query}` }]);
  const out = await tool.runner({ query: 'prices' }, ctx);
  expect(out.output).toContain('refined for prices');
  expect(out.output).not.toContain('beta');
});

test('freshness reaches the runner', async () => {
  let seen: string | undefined;
  const capturing = { available: ['langsearch'], run: async (_q: string, options: any) => { seen = options?.freshness; return results; } };
  await webSearchWith(capturing, async (_q, r) => r).runner({ query: 'q', freshness: 'oneDay' }, ctx);
  expect(seen).toBe('oneDay');
});

test('web_search is absent without a key and present with one', async () => {
  const server = startFakeProvider();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-web-search-'));
  const priorState = process.env.JAMCLI_STATE_DIR;
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, active_profile: 'default' }));
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_provider: 'ollama', preferred_model: 'fake-model' }));
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  try {
    delete process.env.LANGSEARCH_API_KEY;
    const without = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false });
    expect(without.tools.map((tool) => tool.name)).not.toContain('web_search');
    process.env.LANGSEARCH_API_KEY = 'test-key';
    const withKey = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false });
    expect(withKey.tools.map((tool) => tool.name)).toContain('web_search');
  } finally {
    delete process.env.LANGSEARCH_API_KEY;
    if (priorState === undefined) delete process.env.JAMCLI_STATE_DIR;
    else process.env.JAMCLI_STATE_DIR = priorState;
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
