import { afterAll, beforeAll, expect, test } from 'bun:test';
import { SessionModel } from '../model.js';
import { ModelCatalog } from '../../catalog/index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { ApiRegistry, Profile } from '../../../types/config.js';

let server: FakeProviderServer;
beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

const profile = { name: 'Default', preferred_model: 'fake-model' } as Profile;
const model = (registry: ApiRegistry | undefined, observed: string[] = []) =>
  new SessionModel({
    catalog: new ModelCatalog({ registry, cache: false, directory: false }),
    registry,
    profile,
    sessionId: 's1',
    ref: undefined,
    observe: (provider, name) => (observed.push(name), provider),
  });

test("the profile's model is served by an observed provider, and a switch replaces the choice, provider, and facts", async () => {
  const observed: string[] = [];
  const session = model({ ollama: { endpoint: server.ollamaBaseUrl } }, observed);
  expect(session.ref).toBe('ollama:fake-model');
  expect(session.provider).toBeDefined();
  expect(session.providerError).toBeUndefined();
  expect(session.windowKnown).toBe(true);

  // A question the switch overtook changes nothing.
  const asked = session.resolve();
  expect(session.switch('ollama:other-model')).toBe('ollama:fake-model');
  expect(await asked).toBeUndefined();
  expect(session.info.model).toBe('other-model');
  expect(observed).toEqual(['ollama', 'ollama']);
  expect(() => session.switch('openai:gpt-x')).toThrow();
  expect(session.ref).toBe('ollama:other-model');

  server.enqueue({ text: 'a message', usage: { prompt: 12, completion: 3 } });
  const answer = await session.complete('draft a commit message', { maxOutputTokens: 400 });
  expect(answer).toMatchObject({ content: 'a message', usage: { model: 'ollama:other-model', usage: { prompt_tokens: 12, completion_tokens: 3 }, cost: 0 } });
});

test('with no provider configured, the session says why and no request is made', async () => {
  const session = new SessionModel({ catalog: new ModelCatalog({ cache: false, directory: false }), registry: {}, profile: { name: 'x', preferred_provider: 'openai', preferred_model: 'gpt-x' } as Profile, sessionId: 's1', ref: undefined, observe: (provider) => provider });
  expect(session.provider).toBeUndefined();
  expect(session.providerError).toBeTruthy();
  await expect(session.complete('hi')).rejects.toThrow(session.providerError!);
});
