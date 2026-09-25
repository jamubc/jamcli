import { randomBytes } from 'crypto';
import type { OAuthClientMetadata, OAuthClientProvider, OAuthDiscoveryState, StoredOAuthClientInformation, StoredOAuthTokens, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { CredentialStore } from '../config/credentials.js';
import type { McpServerConfig } from '../../types/mcp.js';
import { connectMcp, createTransport } from './connect.js';

/**
 * Signing in to an HTTP MCP server with OAuth (D20): the authorization code flow with
 * PKCE, the client registered by metadata or dynamically, the issuer checked on the way
 * back (RFC 9207), and the tokens kept in the credential store (D12), never in a file of
 * the project. The SDK runs the protocol; this supplies the storage, the browser, and the
 * loopback address the browser returns to.
 */

const account = (server: McpServerConfig, what: 'tokens' | 'client') => `mcp-oauth:${server.id}:${what}`;

export class StoredOAuthProvider implements OAuthClientProvider {
  /**
   * Set only when this session cannot sign in: a token it lacks is then refused with how
   * to sign in, rather than asked for in a flow nobody can finish.
   */
  prepareTokenRequest?: () => never;
  private verifier: string | undefined;
  private discovery: OAuthDiscoveryState | undefined;
  private readonly expectedState = randomBytes(16).toString('hex');

  constructor(
    private readonly server: McpServerConfig,
    private readonly store: CredentialStore,
    private readonly options: {
      /** Where the browser comes back to; absent when this session cannot sign in. */
      redirectUrl?: string;
      /** Open the authorization page. Without it, signing in is refused with how to do it. */
      authorize?: (url: URL) => void | Promise<void>;
    } = {}
  ) {
    if (!options.authorize) {
      this.prepareTokenRequest = () => {
        throw new Error(`MCP server ${server.id} needs you to sign in. Run jamcli mcp login ${server.id}.`);
      };
    }
  }

  get redirectUrl(): string | undefined {
    return this.options.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'JamCLI',
      redirect_uris: this.options.redirectUrl ? [this.options.redirectUrl] : [],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    } as OAuthClientMetadata;
  }

  /** The value the callback must carry back, compared before the code is redeemed. */
  state(): string {
    return this.expectedState;
  }

  private read<T>(what: 'tokens' | 'client'): T | undefined {
    const text = this.store.get(account(this.server, what));
    if (!text) return undefined;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  }

  clientInformation(): StoredOAuthClientInformation | undefined {
    return this.read<StoredOAuthClientInformation>('client');
  }

  saveClientInformation(info: StoredOAuthClientInformation): void {
    this.store.set(account(this.server, 'client'), JSON.stringify(info));
  }

  tokens(): StoredOAuthTokens | undefined {
    return this.read<StoredOAuthTokens>('tokens');
  }

  saveTokens(tokens: StoredOAuthTokens): void {
    this.store.set(account(this.server, 'tokens'), JSON.stringify(tokens));
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    if (!this.options.authorize) throw new Error(`MCP server ${this.server.id} needs you to sign in. Run jamcli mcp login ${this.server.id}.`);
    await this.options.authorize(url);
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }

  codeVerifier(): string {
    if (!this.verifier) throw new Error('No sign-in is in progress.');
    return this.verifier;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.discovery = state;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.discovery;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all' || scope === 'tokens') this.store.remove(account(this.server, 'tokens'));
    if (scope === 'all' || scope === 'client') this.store.remove(account(this.server, 'client'));
    if (scope === 'all' || scope === 'verifier') this.verifier = undefined;
    if (scope === 'all' || scope === 'discovery') this.discovery = undefined;
  }
}

/** A one-time listener on 127.0.0.1 for the browser's return from signing in. */
export function loopbackCallback(): { redirectUrl: string; callback: (timeoutMs: number) => Promise<URLSearchParams>; close: () => void } {
  let deliver: (params: URLSearchParams) => void = () => undefined;
  const arrived = new Promise<URLSearchParams>((resolve) => (deliver = resolve));
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== '/callback') return new Response('Not found', { status: 404 });
      deliver(url.searchParams);
      const failed = url.searchParams.get('error');
      return new Response(`<!doctype html><title>JamCLI</title><p>${failed ? 'Signing in did not finish. You can close this tab and look at the terminal.' : 'Signed in. You can close this tab and return to the terminal.'}</p>`, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    },
  });
  return {
    redirectUrl: `http://127.0.0.1:${server.port}/callback`,
    callback: (timeoutMs) =>
      Promise.race([arrived, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`No sign-in came back within ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs))]),
    close: () => server.stop(true),
  };
}

export interface LoginOptions {
  store: CredentialStore;
  /** Open the authorization page, as a browser would. */
  open: (url: URL) => void | Promise<void>;
  timeoutMs?: number;
  fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
}

/**
 * Sign in to one HTTP server: open its authorization page, take the code the browser
 * brings back to the loopback address, check its state and issuer, redeem it with the
 * PKCE verifier, and keep the tokens. Returns the server's tool count, from a fresh
 * connection with the new tokens.
 */
export async function mcpLogin(server: McpServerConfig, options: LoginOptions): Promise<{ tools: number }> {
  if (!server.url) throw new Error(`MCP server ${server.id} is not an HTTP server, so it has nothing to sign in to.`);
  const loopback = loopbackCallback();
  try {
    const provider = new StoredOAuthProvider(server, options.store, { redirectUrl: loopback.redirectUrl, authorize: options.open });
    const env: Record<string, string> = {};
    try {
      // Already signed in: nothing more to do.
      const connection = await connectMcp(server, { env, authProvider: provider, ...(options.fetch ? { fetch: options.fetch } : {}) });
      const { tools } = await connection.client.listTools();
      await connection.client.close();
      return { tools: tools.length };
    } catch (error: any) {
      if (!/unauthori[sz]ed/i.test(String(error?.name ?? '') + String(error?.message ?? ''))) throw error;
    }
    const params = await loopback.callback(options.timeoutMs ?? 5 * 60_000);
    if (params.get('error')) throw new Error(`The authorization server refused: ${params.get('error_description') ?? params.get('error')}`);
    if (params.get('state') !== provider.state()) throw new Error('The sign-in came back with a state this login did not send, so it was not used.');
    // HTTP, as checked above, so the transport can redeem the code.
    const transport = createTransport(server, { env, authProvider: provider, ...(options.fetch ? { fetch: options.fetch } : {}) }) as unknown as StreamableHTTPClientTransport;
    await transport.finishAuth(params);
    await transport.close().catch(() => undefined);
    const connection = await connectMcp(server, { env, authProvider: provider, ...(options.fetch ? { fetch: options.fetch } : {}) });
    const { tools } = await connection.client.listTools();
    await connection.client.close();
    return { tools: tools.length };
  } finally {
    loopback.close();
  }
}

/** Forget a server's tokens and registration. False when there were none. */
export function mcpLogout(server: McpServerConfig, store: CredentialStore): boolean {
  const tokens = store.remove(account(server, 'tokens'));
  const client = store.remove(account(server, 'client'));
  return tokens || client;
}
