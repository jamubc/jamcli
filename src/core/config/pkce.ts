import { createHash, randomBytes } from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';

export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/api/v1/auth/keys';

const base64url = (bytes: Buffer) => bytes.toString('base64url');

/** A verifier and its S256 challenge, as RFC 7636 defines them. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export interface LoginOptions {
  /** Show the person the page to sign in on: open a browser, or print the address. */
  open: (url: string) => void | Promise<void>;
  authUrl?: string;
  keysUrl?: string;
  /** How long to wait for the browser to come back. Defaults to five minutes. */
  timeoutMs?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;margin:3rem"><h1>${title}</h1><p>${body}</p></body>`;

/** Listen on the loopback address, on a port the system picks, and on IPv6 loopback too where it can. */
async function listen(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  const servers: http.Server[] = [];
  const start = (host: string, port: number) =>
    new Promise<http.Server>((resolve, reject) => {
      const server = http.createServer(handler);
      server.once('error', reject);
      server.listen(port, host, () => resolve(server));
    });
  const first = await start('127.0.0.1', 0);
  servers.push(first);
  const port = (first.address() as AddressInfo).port;
  // A browser may resolve localhost to ::1 first.
  try {
    servers.push(await start('::1', port));
  } catch {
    // No IPv6 loopback here; 127.0.0.1 is enough.
  }
  return { port, close: () => servers.forEach((server) => server.close()) };
}

/**
 * Sign in to OpenRouter with PKCE and return the key it issues. A local server on a
 * random port waits for the browser at a path no one else knows; the code it brings
 * back is exchanged, with the verifier, for a key the user controls.
 */
export async function openRouterLogin(options: LoginOptions): Promise<string> {
  const { verifier, challenge } = pkcePair();
  const nonce = base64url(randomBytes(16));
  const doFetch = options.fetch ?? fetch;

  let settle!: { resolve: (code: string) => void; reject: (error: Error) => void };
  const codeArrived = new Promise<string>((resolve, reject) => (settle = { resolve, reject }));
  // It may fail before it is awaited, while the browser is being opened.
  codeArrived.catch(() => undefined);
  const server = await listen((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== `/callback/${nonce}`) {
      response.writeHead(404, { 'content-type': 'text/html' }).end(page('Not found', 'This address is not a JamCLI sign-in.'));
      return;
    }
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (!code) {
      response.writeHead(400, { 'content-type': 'text/html' }).end(page('Sign-in failed', 'OpenRouter sent no code back. Return to the terminal.'));
      settle.reject(new Error(`OpenRouter sent no code back${error ? `: ${error}` : ''}.`));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end(page('JamCLI is signed in', 'You can close this tab and return to the terminal.'));
    settle.resolve(code);
  });

  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => settle.reject(new Error('The sign-in was cancelled.'));
  try {
    options.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => settle.reject(new Error(`No sign-in arrived within ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
    const callback = `http://localhost:${server.port}/callback/${nonce}`;
    const authorize = new URL(options.authUrl ?? OPENROUTER_AUTH_URL);
    authorize.searchParams.set('callback_url', callback);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    await options.open(authorize.toString());
    const code = await codeArrived;

    const response = await doFetch(options.keysUrl ?? OPENROUTER_KEYS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
      signal: options.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const detail = (() => {
        try {
          const parsed = JSON.parse(text);
          return parsed?.error?.message ?? parsed?.message ?? '';
        } catch {
          return '';
        }
      })();
      throw new Error(`OpenRouter refused the sign-in (${response.status})${detail ? `: ${detail}` : ''}. A code lasts a few minutes; run the login again.`);
    }
    const key = (() => {
      try {
        return JSON.parse(text)?.key;
      } catch {
        return undefined;
      }
    })();
    if (typeof key !== 'string' || !key) throw new Error('OpenRouter answered the sign-in without a key.');
    return key;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    server.close();
  }
}
