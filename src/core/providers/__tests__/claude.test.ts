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
