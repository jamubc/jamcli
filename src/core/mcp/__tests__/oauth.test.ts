import { afterEach, expect, test } from 'bun:test';
import type { CredentialStore } from '../../config/credentials.js';
import { mcpLogin, mcpLogout, StoredOAuthProvider } from '../oauth.js';
import { connectMcp } from '../connect.js';
import { startFakeOAuthMcp } from '../../../testing/fakeOAuthMcp.js';
import type { McpServerConfig } from '../../../types/mcp.js';

const memoryStore = (): CredentialStore & { entries: Map<string, string> } => {
  const entries = new Map<string, string>();
  return {
    kind: 'file',
    where: 'memory',
    entries,
    get: (account) => entries.get(account),
    set: (account, secret) => void entries.set(account, secret),
    remove: (account) => entries.delete(account),
  };
};

/** A browser that follows the authorization server's redirect back to the loopback address. */
const browser = async (url: URL) => {
  const answer = await fetch(url, { redirect: 'manual' });
  const back = answer.headers.get('location');
  if (back) await fetch(back);
};

let stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
});

test('signing in runs the code flow with PKCE, keeps the tokens in the store, and later connections use them', async () => {
  const fake = startFakeOAuthMcp();
  stops.push(fake.stop);
  const server: McpServerConfig = { id: 'remote', command: '', transport: 'http', url: fake.url };
  const store = memoryStore();

  // Without signing in, the server is refused with how to sign in.
  await expect(connectMcp(server, { env: {}, authProvider: new StoredOAuthProvider(server, store) })).rejects.toThrow('Run jamcli mcp login remote.');

  const opened: string[] = [];
  const result = await mcpLogin(server, { store, open: (url) => (opened.push(url.toString()), browser(url)), timeoutMs: 10_000 });
  expect(result).toEqual({ tools: 4 });
  expect(opened).toHaveLength(1);
  const authorize = new URL(opened[0]);
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorize.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  expect(authorize.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
  expect(fake.seen).toMatchObject({ registrations: 1, pkceMethods: ['S256'], verified: 1 });
  const tokens = JSON.parse(store.entries.get('mcp-oauth:remote:tokens')!);
  expect(fake.tokens.has(tokens.access_token)).toBe(true);
  expect(JSON.parse(store.entries.get('mcp-oauth:remote:client')!).client_id).toBe('client-1');

  // A later session, which cannot sign in itself, connects with the stored token.
  const later = await connectMcp(server, { env: {}, authProvider: new StoredOAuthProvider(server, store) });
  expect((await later.client.listTools()).tools).toHaveLength(4);
  await later.client.close();
  expect(fake.seen.bearer).toContain(tokens.access_token);

  expect(mcpLogout(server, store)).toBe(true);
  expect(store.entries.size).toBe(0);
  expect(mcpLogout(server, store)).toBe(false);
}, 20_000);

test('a code that comes back naming another issuer is not redeemed', async () => {
  const fake = startFakeOAuthMcp({ callbackIssuer: () => 'https://attacker.example' });
  stops.push(fake.stop);
  const server: McpServerConfig = { id: 'mixup', command: '', transport: 'http', url: fake.url };
  const store = memoryStore();
  await expect(mcpLogin(server, { store, open: browser, timeoutMs: 10_000 })).rejects.toThrow(/issuer/i);
  expect(fake.seen.verified).toBe(0);
  expect(store.entries.has('mcp-oauth:mixup:tokens')).toBe(false);
}, 20_000);

test('a callback whose state this login did not send is refused', async () => {
  const fake = startFakeOAuthMcp();
  stops.push(fake.stop);
  const server: McpServerConfig = { id: 'forged', command: '', transport: 'http', url: fake.url };
  const store = memoryStore();
  const forged = async (url: URL) => {
    const answer = await fetch(url, { redirect: 'manual' });
    const back = new URL(answer.headers.get('location')!);
    back.searchParams.set('state', 'not-the-one-sent');
    await fetch(back);
  };
  await expect(mcpLogin(server, { store, open: forged, timeoutMs: 10_000 })).rejects.toThrow('a state this login did not send');
  expect(fake.seen.verified).toBe(0);
  await expect(mcpLogin({ id: 'local', command: 'x' }, { store, open: browser })).rejects.toThrow('is not an HTTP server');
}, 20_000);
