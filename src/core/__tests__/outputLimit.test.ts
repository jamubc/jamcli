import { afterAll, beforeAll, expect, test } from 'bun:test';
import { CoreAgent } from '../agent.js';
import { createSession } from '../state.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { OllamaProvider } from '../providers/ollama.js';
import { OpenAICompatProvider } from '../providers/openai-compat.js';
import type { ChatProvider } from '../providers/types.js';
import { startFakeProvider, type FakeProviderServer } from '../../testing/fakeProvider.js';

let server: FakeProviderServer;
beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

const noticesFrom = async (provider: ChatProvider, maxOutputTokens?: number) => {
  const agent = new CoreAgent({ provider, model: 'fake-model', maxOutputTokens });
  const notices: string[] = [];
  const result = await agent.run(createSession('/tmp/output-limit', 'output-limit'), 'write a lot', (event) => {
    if (event.type === 'notice') notices.push(event.message);
  });
  return { notices, result };
};

test('a reply cut off at the output limit says so, in each wire format', async () => {
  const cases: [ChatProvider, string][] = [
    [new AnthropicProvider({ baseUrl: server.anthropicBaseUrl }), 'max_tokens'],
    [new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl }), 'length'],
    [new OllamaProvider({ endpoint: server.ollamaBaseUrl }), 'length'],
  ];
  for (const [provider, stopReason] of cases) {
    server.enqueue({ text: 'half a rep', stopReason });
    const { notices, result } = await noticesFrom(provider, 1_000);
    expect(notices).toEqual([
      'The reply stopped at the output limit of 1,000 tokens, so it may be incomplete. Raise agent_loop.max_output_tokens, or ask the model to continue.',
    ]);
    // The partial reply is kept and returned.
    expect(result.response).toBe('half a rep');
  }
});

test('a limit the session did not set is still reported, and a reply that ends on its own is not', async () => {
  const provider = new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl });
  server.enqueue({ text: 'half a rep', stopReason: 'length' }, { text: 'done' });
  expect((await noticesFrom(provider)).notices).toEqual([
    'The reply stopped at the output limit, so it may be incomplete. Raise agent_loop.max_output_tokens, or ask the model to continue.',
  ]);
  expect((await noticesFrom(provider)).notices).toEqual([]);
});
