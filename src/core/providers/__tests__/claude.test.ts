import { afterEach, beforeEach, expect, test } from 'bun:test';
import { AnthropicProvider } from '../anthropic.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { ProviderRequestOptions } from '../types.js';

let server: FakeProviderServer;
beforeEach(() => {
  server = startFakeProvider();
});
afterEach(() => server.close());

const user = (content: string) => ({ role: 'user' as const, content, timestamp: 0 });

/** The body of one request made with these options. */
async function sent(options: Partial<ProviderRequestOptions>) {
  server.enqueue({ text: 'ok' });
  await new AnthropicProvider({ baseUrl: server.anthropicBaseUrl }).complete([user('hi')], { model: 'claude-x', ...options });
  return server.completions().at(-1)!.body;
}

test('a temperature is sent only to a model sure to accept it', async () => {
  // Current models refuse any temperature but the default, and unknown ones may too.
  expect((await sent({ temperature: 0.7, thinkingStyle: 'adaptive' })).temperature).toBeUndefined();
  expect((await sent({ temperature: 0.7 })).temperature).toBeUndefined();
  // A model that takes a thinking budget accepts one while it is not thinking.
  expect((await sent({ temperature: 0.7, thinkingStyle: 'budget' })).temperature).toBe(0.7);
  expect((await sent({ temperature: 0.7, thinkingStyle: 'budget', reasoning: 'on' })).temperature).toBeUndefined();
});

test('thinking follows the model: adaptive where it decides, a budget only when asked, off where allowed', async () => {
  expect((await sent({ thinkingStyle: 'adaptive' })).thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  expect((await sent({ thinkingStyle: 'adaptive', reasoning: 'on' })).thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  expect((await sent({ thinkingStyle: 'adaptive', reasoning: 'off' })).thinking).toEqual({ type: 'disabled' });
  // A model that always thinks refuses to be turned off, so it is left at its default.
  expect((await sent({ thinkingStyle: 'adaptive', alwaysThinks: true, reasoning: 'off' })).thinking).toBeUndefined();

  expect((await sent({ thinkingStyle: 'budget', reasoning: 'on', maxOutputTokens: 32_000 })).thinking).toEqual({ type: 'enabled', budget_tokens: 16_000 });
  expect((await sent({ thinkingStyle: 'budget' })).thinking).toBeUndefined();
  // Too small an output limit leaves no budget the API accepts.
  expect((await sent({ thinkingStyle: 'budget', reasoning: 'on', maxOutputTokens: 2_000 })).thinking).toBeUndefined();
  // A model the catalog does not know is not configured, and explicit parameters win.
  expect((await sent({ reasoning: 'on' })).thinking).toBeUndefined();
  expect((await sent({ thinkingStyle: 'adaptive', extraParams: { thinking: { type: 'disabled' } } })).thinking).toEqual({ type: 'disabled' });
});

const tools = ['read_file', 'grep'].map((name) => ({ type: 'function' as const, function: { name, parameters: { type: 'object' } } }));
const breakpoints = (body: any) =>
  [
    ...(Array.isArray(body.system) ? body.system : []),
    ...(body.tools ?? []),
    ...body.messages.flatMap((message: any) => (Array.isArray(message.content) ? message.content : [])),
  ].filter((part: any) => part.cache_control);

test('the tool list, the system prompt, and the conversation each end on a cache breakpoint', async () => {
  server.enqueue({ text: 'ok' });
  const provider = new AnthropicProvider({ baseUrl: server.anthropicBaseUrl });
  await provider.complete(
    [
      { role: 'system', content: 'rules', timestamp: 0 },
      user('first'),
      { role: 'assistant', content: 'reply', timestamp: 0, providerFamily: 'anthropic', reasoningBlocks: [{ type: 'thinking', text: 't', signature: 's' }] },
      user('second'),
    ],
    { model: 'claude-x', tools }
  );
  const body = server.completions().at(-1)!.body;
  expect(body.system).toEqual([{ type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } }]);
  expect(body.tools.map((tool: any) => Boolean(tool.cache_control))).toEqual([false, true]);
  expect(body.messages.at(-1).content.at(-1)).toEqual({ type: 'text', text: 'second', cache_control: { type: 'ephemeral' } });
  // Three of the four breakpoints the API allows, and never on thinking.
  expect(breakpoints(body)).toHaveLength(3);
  expect(body.messages[1].content[0]).toEqual({ type: 'thinking', thinking: 't', signature: 's' });
});

test('the breakpoint skips what cannot carry one', async () => {
  server.enqueue({ text: 'ok' });
  const provider = new AnthropicProvider({ baseUrl: server.anthropicBaseUrl });
  await provider.complete(
    [user('go'), { role: 'assistant', content: '', timestamp: 0, providerFamily: 'anthropic', reasoningBlocks: [{ type: 'thinking', text: 't', signature: 's' }] }],
    { model: 'claude-x' }
  );
  const last = server.completions().at(-1)!.body.messages.at(-1).content;
  // An assistant turn of nothing but thinking leaves nothing to mark in it.
  expect(last.filter((part: any) => part.cache_control)).toEqual([]);

  server.enqueue({ text: 'ok' });
  await provider.complete([user('go'), { role: 'assistant', content: '', timestamp: 0 }], { model: 'claude-x' });
  const empty = server.completions().at(-1)!.body.messages.at(-1).content;
  // Nor does an empty text block, which the API refuses to mark.
  expect(empty).toEqual([{ type: 'text', text: '' }]);
});

test('an endpoint that rejects cache_control gets one retry without it, and never gets it again', async () => {
  server.enqueue(
    { status: 400, errorBody: { type: 'error', error: { type: 'invalid_request_error', message: 'Extra inputs are not permitted: cache_control' } } },
    { text: 'first' },
    { text: 'second' }
  );
  const provider = new AnthropicProvider({ baseUrl: server.anthropicBaseUrl });
  expect((await provider.complete([{ role: 'system', content: 'rules', timestamp: 0 }, user('hi')], { model: 'claude-x', tools })).content).toBe('first');
  const [rejected, retried] = server.completions().slice(-2);
  expect(breakpoints(rejected.body)).toHaveLength(3);
  expect(breakpoints(retried.body)).toEqual([]);
  expect(retried.body.system).toBe('rules');
  await provider.complete([user('again')], { model: 'claude-x', tools });
  expect(breakpoints(server.completions().at(-1)!.body)).toEqual([]);

  // Any other refusal is not retried.
  server.enqueue({ status: 400, errorBody: { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: too large' } } });
  const fresh = new AnthropicProvider({ baseUrl: server.anthropicBaseUrl });
  await expect(fresh.complete([user('hi')], { model: 'claude-x' })).rejects.toThrow('max_tokens: too large');
});
