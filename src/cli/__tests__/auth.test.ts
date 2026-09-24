import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { runAuthCommand, type AuthAction, type AuthCommandIo } from '../auth.js';
import { fileStore, forgetStoredKeys } from '../../core/config/credentials.js';
import { openRouterLogin, pkcePair } from '../../core/config/pkce.js';
import { parseArgs } from '../../cli.js';
import { createChatProvider } from '../../core/providers/factory.js';

let root: string;
const saved = { config: process.env.JAMCLI_CONFIG_DIR, key: process.env.OPENROUTER_API_KEY };

beforeEach(() => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-auth-')));
  root = path.join(base, 'project');
  fs.mkdirSync(root);
  process.env.JAMCLI_CONFIG_DIR = path.join(base, 'user');
  delete process.env.OPENROUTER_API_KEY;
  forgetStoredKeys();
});
afterEach(() => {
  process.env.JAMCLI_CONFIG_DIR = saved.config;
  if (saved.key === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = saved.key;
  forgetStoredKeys();
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

async function auth(action: AuthAction, args: string[] = [], extra: Partial<AuthCommandIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runAuthCommand({ action, args }, root, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    readKey: async () => 'sk-or-v1-typed-key-1234',
    openUrl: () => undefined,
    ...extra,
  });
  return { code, out, err };
}

test('set stores a key typed at a prompt, get shows it masked, and remove takes it away', async () => {
  const file = path.join(process.env.JAMCLI_CONFIG_DIR!, 'credentials.json');
  expect(await auth('set', ['openrouter'])).toMatchObject({ code: 0, out: [`Stored the key for openrouter (sk-or-...1234) in ${file}, readable only by you.`] });
  expect(fileStore().get('openrouter')).toBe('sk-or-v1-typed-key-1234');

  const shown = await auth('get', ['openrouter']);
  expect(shown.out).toEqual([`A key for openrouter (sk-or-...1234) is stored in ${file}, readable only by you.`, 'openrouter uses the key from the credential store.']);
  expect(shown.out.join('\n')).not.toContain('typed-key');
  expect((await auth('get', ['openrouter', '--reveal'])).out).toEqual(['sk-or-v1-typed-key-1234']);
  expect((await auth('list')).out).toContain('openrouter\tthe credential store');

  expect(await auth('remove', ['openrouter'])).toMatchObject({ code: 0 });
  expect(await auth('remove', ['openrouter'])).toMatchObject({ code: 1 });
  expect((await auth('get', ['openrouter'])).out.at(-1)).toBe('openrouter has no key.');
});

test('a key the environment overrides is stored with a warning, and a bad key is refused', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-or-v1-environment';
  expect((await auth('set', ['openrouter'])).err).toEqual(['The OPENROUTER_API_KEY environment variable also holds a key for openrouter, and is used first.']);
  expect(await auth('set', ['openai'], { readKey: async () => '' })).toMatchObject({ code: 1, err: ['No key was given, so nothing was stored.'] });
  expect(await auth('set', ['openai'], { readKey: async () => 'two words' })).toMatchObject({ code: 1 });
  expect(fileStore().get('openai')).toBeUndefined();
  expect((await auth('set', ['mystery'])).err[0]).toStartWith('Note: mystery is not a built-in provider');
  expect(parseArgs(['auth', 'set', 'openrouter']).authCommand).toEqual({ action: 'set', args: ['openrouter'] });
});

/** OpenRouter's side of the sign-in, as the login expects it: a key for a code and its verifier. */
async function fakeOpenRouter(options: { status?: number } = {}) {
  const issued = new Map<string, string>();
  const exchanges: any[] = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body || '{}');
    exchanges.push(parsed);
    const challenge = issued.get(parsed.code);
    const matches = challenge && createHash('sha256').update(parsed.code_verifier).digest('base64url') === challenge;
    if (options.status || !matches) {
      response.writeHead(options.status ?? 403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Invalid code or verifier' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ key: 'sk-or-v1-issued-by-pkce', user_id: 'user-1' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const keysUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/auth/keys`;
  /** The person's browser: sign in, then follow the callback with a code. */
  const browser = (callbackPath = (callback: URL) => callback.pathname) => async (url: string) => {
    const authorize = new URL(url);
    expect(`${authorize.origin}${authorize.pathname}`).toBe('https://openrouter.test/auth');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    const callback = new URL(authorize.searchParams.get('callback_url')!);
    expect(callback.hostname).toBe('localhost');
    issued.set('code-1', authorize.searchParams.get('code_challenge')!);
    const landed = await fetch(`http://127.0.0.1:${callback.port}${callbackPath(callback)}?code=code-1`);
    return landed.status;
  };
  return { keysUrl, exchanges, browser, close: () => server.close() };
}

test('login opens the sign-in page, takes the code at its callback, and stores the key it is given', async () => {
  const openRouter = await fakeOpenRouter();
  let landed = 0;
  try {
    const result = await auth('login', ['openrouter'], {
      openUrl: (url) => void openRouter.browser()(url).then((status) => (landed = status)),
      openRouter: { authUrl: 'https://openrouter.test/auth', keysUrl: openRouter.keysUrl },
    });
    expect(result.code).toBe(0);
    expect(result.err[0]).toStartWith('Sign in to OpenRouter at:\n  https://openrouter.test/auth?callback_url=');
    expect(result.out).toEqual([expect.stringMatching(/^Stored the key for openrouter \(sk-or-\.\.\.pkce\)/)]);
    expect(fileStore().get('openrouter')).toBe('sk-or-v1-issued-by-pkce');
    expect(openRouter.exchanges).toEqual([{ code: 'code-1', code_verifier: expect.any(String), code_challenge_method: 'S256' }]);
    expect(landed).toBe(200);
    // --no-browser only prints the address.
    let opened = false;
    await auth('login', ['openrouter', '--no-browser'], {
      openUrl: () => (opened = true),
      openRouter: { authUrl: 'https://openrouter.test/auth', keysUrl: openRouter.keysUrl, timeoutMs: 50 },
    });
    expect(opened).toBe(false);
  } finally {
    openRouter.close();
  }
});

test('the callback answers only at its own path, and a refused exchange or a timeout is reported', async () => {
  const openRouter = await fakeOpenRouter();
  try {
    // A request to any other path is turned away and the login keeps waiting, until it times out.
    let stray = 0;
    const waited = openRouterLogin({
      authUrl: 'https://openrouter.test/auth',
      keysUrl: openRouter.keysUrl,
      timeoutMs: 300,
      open: async (url) => void (stray = await openRouter.browser(() => '/callback/guess')(url)),
    });
    await expect(waited).rejects.toThrow('No sign-in arrived within 0 seconds.');
    expect(stray).toBe(404);
    expect(openRouter.exchanges).toEqual([]);
  } finally {
    openRouter.close();
  }

  const refusing = await fakeOpenRouter({ status: 403 });
  try {
    const result = await auth('login', ['openrouter'], {
      openUrl: (url) => void refusing.browser()(url),
      openRouter: { authUrl: 'https://openrouter.test/auth', keysUrl: refusing.keysUrl },
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain('OpenRouter refused the sign-in (403): Invalid code or verifier. A code lasts a few minutes; run the login again.');
    expect(fileStore().get('openrouter')).toBeUndefined();
  } finally {
    refusing.close();
  }
  expect((await auth('login', ['anthropic'])).err).toEqual(['Signing in works for openrouter only. For anthropic, run jamcli auth set anthropic.']);
});

test('a PKCE challenge is the unpadded base64url SHA-256 of its verifier', () => {
  const { verifier, challenge } = pkcePair();
  expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  expect(challenge).not.toContain('=');
});

test('a provider with no key says how to store one', () => {
  expect(() => createChatProvider('openrouter', {})).toThrow('Store a key with jamcli auth set openrouter or jamcli auth login openrouter, set OPENROUTER_API_KEY');
  expect(() => createChatProvider('anthropic', {})).toThrow('To use a compatible server instead, set api_registry.anthropic.base_url.');
  fileStore().set('anthropic', 'sk-ant-stored-for-factory');
  expect(() => createChatProvider('anthropic', {})).not.toThrow();
});
