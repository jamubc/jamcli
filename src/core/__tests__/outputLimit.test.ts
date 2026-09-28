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

test('a reply the model declined says so, rather than reading as a finished answer', async () => {
  server.enqueue({ text: '', stopReason: 'refusal' });
  const { notices, result } = await noticesFrom(new AnthropicProvider({ baseUrl: server.anthropicBaseUrl }));
  expect(notices).toEqual(['The model declined this request, so the reply may be empty or partial. Rephrase it, or switch models with /model.']);
  expect(result.status).toBe('ok');
});

test('a completion the harness caps runs with thinking off, and an empty reply that spent the cap is asked for once more with twice the room', async () => {
  const { completeWithinCap } = await import('../providers/complete.js');
  const provider = new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl });
  const messages = [{ role: 'user' as const, content: 'draft it', timestamp: 0 }];
  server.enqueue({ text: '', stopReason: 'length', usage: { prompt: 10, completion: 400 } }, { text: 'feat: the draft', usage: { prompt: 10, completion: 5 } });
  const result = await completeWithinCap(provider, messages, { model: 'fake-model', maxOutputTokens: 400 });
  expect(result.content).toBe('feat: the draft');
  expect(result.usage).toMatchObject({ prompt_tokens: 20, completion_tokens: 405 });
  const requests = server.completions().slice(-2).map((request) => request.body);
  expect(requests.map((body) => body.max_tokens ?? body.max_completion_tokens)).toEqual([400, 800]);
  // A reply that came back whole is not asked for again, and a cut-off reply with text is kept as it is.
  server.enqueue({ text: 'done', usage: { prompt: 1, completion: 1 } });
  expect((await completeWithinCap(provider, messages, { model: 'fake-model', maxOutputTokens: 400 })).content).toBe('done');
  server.enqueue({ text: 'half', stopReason: 'length', usage: { prompt: 1, completion: 400 } });
  expect((await completeWithinCap(provider, messages, { model: 'fake-model', maxOutputTokens: 400 })).content).toBe('half');
});
