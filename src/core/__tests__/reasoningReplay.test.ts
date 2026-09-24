import { afterEach, beforeEach, expect, test } from 'bun:test';
import { CoreAgent } from '../agent.js';
import { createSession } from '../state.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { startFakeProvider, type FakeProviderServer } from '../../testing/fakeProvider.js';

let server: FakeProviderServer;
beforeEach(() => {
  server = startFakeProvider();
});
afterEach(() => server.close());

test('a reply dated in the millisecond its prefix was set still has its thinking replayed', async () => {
  // A prefix set just now dates the cutoff past the clock, as a mode switch or a compaction does.
  // Stretched here, so the turn starts before the clock reaches it.
  const agent = new CoreAgent({ provider: new AnthropicProvider({ baseUrl: server.anthropicBaseUrl }), model: 'claude-x', reasoningSince: Date.now() + 25 });
  server.enqueue({ text: 'one', reasoning: 'r1', reasoningSignature: 'sig-1' }, { text: 'two' });
  const first = await agent.run(createSession('/tmp/replay', 'replay'), 'first', () => {});
  await agent.run(first.session!, 'second', () => {});
  const replayed = server
    .completions()
    .at(-1)!
    .body.messages.flatMap((message: any) => (Array.isArray(message.content) ? message.content : []))
    .filter((block: any) => block.type === 'thinking')
    .map((block: any) => block.signature);
  expect(replayed).toEqual(['sig-1']);
});
