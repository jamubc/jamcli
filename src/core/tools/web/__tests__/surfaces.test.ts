import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startFakeProvider, type FakeProviderServer } from '../../../../testing/fakeProvider.js';
import { createRuntime } from '../../../runtime/index.js';
import { runHeadless } from '../../../../cli/run.js';
import { createAcpSession } from '../../../../acp/session.js';
import { createInterfaceRuntime } from '../../../../tui/runtime.js';
import type { AgentEvent } from '../../../types.js';

let server: FakeProviderServer;
let root: string;
let page: ReturnType<typeof Bun.serve>;
let priorState: string | undefined;
const realFetch = globalThis.fetch;

beforeAll(() => {
  server = startFakeProvider();
  page = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => new Response('<main><p>local page text</p></main>', { headers: { 'content-type': 'text/html' } }),
  });
});
afterAll(() => {
  server.close();
  page.stop(true);
});
beforeEach(() => {
  delete process.env.LANGSEARCH_API_KEY;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-web-surface-'));
  priorState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, active_profile: 'default' }));
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_provider: 'ollama', preferred_model: 'fake-model' }));
});
afterEach(() => {
  delete process.env.LANGSEARCH_API_KEY;
  globalThis.fetch = realFetch;
  if (priorState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = priorState;
  fs.rmSync(root, { recursive: true, force: true });
});

const toolMessages = (body: any) =>
  body.messages.filter((message: any) => message.role === 'tool').map((message: any) => String(message.content));

const stubLangSearch = () => {
  process.env.LANGSEARCH_API_KEY = 'test-key';
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).startsWith('https://api.langsearch.com/')) {
      return new Response(
        JSON.stringify({ data: { webPages: { value: [{ url: 'https://docs.example/a', name: 'Guide', text: 'page body '.repeat(20) }] } } }),
        { status: 200 }
      );
    }
    return realFetch(url, init);
  }) as unknown as typeof fetch;
};

test('with no key the session starts, web_search is absent, and web_fetch fails with a reason', async () => {
  const runtime = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false, allowTools: ['web_fetch'] });
  expect(runtime.tools.map((tool) => tool.name)).not.toContain('web_search');
  server.enqueue({ toolCalls: [{ id: 'w1', name: 'web_fetch', arguments: { url: 'http://127.0.0.1:1/x' } }] }, { text: 'gave up' });
  await runtime.run('fetch the closed port');
  expect(toolMessages(server.completions().at(-1)!.body).join('\n')).toContain('Could not fetch');
});

test('with a key, web_search is offered and its results reach the model', async () => {
  stubLangSearch();
  const runtime = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false, allowTools: ['web_search'] });
  expect(runtime.tools.map((tool) => tool.name)).toContain('web_search');
  server.enqueue({ toolCalls: [{ id: 's1', name: 'web_search', arguments: { query: 'docs' } }] }, { text: 'found it' });
  await runtime.run('search the docs');
  const sent = toolMessages(server.completions().at(-1)!.body).join('\n');
  expect(sent).toContain('Guide');
  expect(sent).toContain('page body');
});

/** A person allowing an approval, the same way every surface answers one. */
const allow = (event: AgentEvent) => {
  if (event.type === 'approval_request') event.decide(true);
};

const surfaces: Record<string, (prompt: string, allowTools: string[]) => Promise<void>> = {
  acp: async (prompt, allowTools) => {
    const session = await createAcpSession({ projectRoot: root, cwd: root, runtime: { mcp: false, allowTools } });
    await session.run(prompt, allow);
    await session.close?.();
  },
  tui: async (prompt, allowTools) => {
    const runtime = await createInterfaceRuntime({ projectRoot: root, mcp: false, allowTools });
    await runtime.run(prompt, allow);
    await runtime.close();
  },
};

for (const [name, run] of Object.entries(surfaces)) {
  test(`${name}: with no key, web_fetch fails with a reason and the session continues`, async () => {
    server.enqueue({ toolCalls: [{ id: 'w1', name: 'web_fetch', arguments: { url: 'http://127.0.0.1:1/x' } }] }, { text: 'gave up' });
    await run('fetch the closed port', ['web_fetch']);
    expect(toolMessages(server.completions().at(-1)!.body).join('\n')).toContain('Could not fetch');
  });

  test(`${name}: with a key, web_search results reach the model`, async () => {
    stubLangSearch();
    server.enqueue({ toolCalls: [{ id: 's1', name: 'web_search', arguments: { query: 'docs' } }] }, { text: 'found it' });
    await run('search the docs', ['web_search']);
    const sent = toolMessages(server.completions().at(-1)!.body).join('\n');
    expect(sent).toContain('Guide');
    expect(sent).toContain('page body');
  });
}

test('headless: the same two scripts, run through runHeadless, drive the same tool results', async () => {
  server.enqueue({ toolCalls: [{ id: 'w1', name: 'web_fetch', arguments: { url: 'http://127.0.0.1:1/x' } }] }, { text: 'gave up' });
  await runHeadless({ prompt: 'fetch the closed port', projectRoot: root, allowTools: ['web_fetch'], runtime: { mcp: false } });
  expect(toolMessages(server.completions().at(-1)!.body).join('\n')).toContain('Could not fetch');

  stubLangSearch();
  server.enqueue({ toolCalls: [{ id: 's1', name: 'web_search', arguments: { query: 'docs' } }] }, { text: 'found it' });
  await runHeadless({ prompt: 'search the docs', projectRoot: root, allowTools: ['web_search'], runtime: { mcp: false } });
  const sent = toolMessages(server.completions().at(-1)!.body).join('\n');
  expect(sent).toContain('Guide');
  expect(sent).toContain('page body');
});
