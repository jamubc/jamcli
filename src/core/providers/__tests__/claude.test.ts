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
