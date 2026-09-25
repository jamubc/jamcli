import { createHash, randomBytes } from 'crypto';
import { modernHttpHandler } from './modernMcpServer.js';

export interface FakeOAuthOptions {
  /** The issuer the authorization response names, to test the RFC 9207 check. */
  callbackIssuer?: (issuer: string) => string;
}

/**
 * An MCP server behind OAuth for tests: protected resource metadata (RFC 9728),
 * authorization server metadata (RFC 8414) announcing the `iss` response parameter,
 * dynamic registration, an authorization endpoint that approves at once, and a token
 * endpoint that checks the PKCE verifier. The MCP endpoint answers 401 without a token it
 * issued.
 */
export function startFakeOAuthMcp(options: FakeOAuthOptions = {}) {
  const handler = modernHttpHandler();
  const challenges = new Map<string, { challenge: string; method: string; redirect: string }>();
  const tokens = new Set<string>();
  const seen = { registrations: 0, pkceMethods: [] as string[], verified: 0, bearer: [] as string[] };
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      const base: string = `http://127.0.0.1:${server.port}`;
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json({ resource: `${base}/mcp`, authorization_servers: [base] });
      if (url.pathname.startsWith('/.well-known/oauth-authorization-server') || url.pathname.startsWith('/.well-known/openid-configuration')) {
        return json({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          authorization_response_iss_parameter_supported: true,
        });
      }
      if (url.pathname === '/register' && request.method === 'POST') {
        seen.registrations += 1;
        const body = await request.json();
        return json({ ...body, client_id: `client-${seen.registrations}`, client_id_issued_at: Math.floor(Date.now() / 1000) }, 201);
      }
      if (url.pathname === '/authorize') {
        const code = randomBytes(8).toString('hex');
        const method = url.searchParams.get('code_challenge_method') ?? 'plain';
        seen.pkceMethods.push(method);
        challenges.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', method, redirect: url.searchParams.get('redirect_uri') ?? '' });
        const back = new URL(url.searchParams.get('redirect_uri') ?? '');
        back.searchParams.set('code', code);
        back.searchParams.set('state', url.searchParams.get('state') ?? '');
        back.searchParams.set('iss', options.callbackIssuer ? options.callbackIssuer(base) : base);
        return new Response(null, { status: 302, headers: { location: back.toString() } });
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        const form = new URLSearchParams(await request.text());
        if (form.get('grant_type') === 'refresh_token') {
          const token = randomBytes(12).toString('hex');
          tokens.add(token);
          return json({ access_token: token, token_type: 'Bearer', expires_in: 3600 });
        }
        const issued = challenges.get(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const hashed = createHash('sha256').update(verifier).digest('base64url');
        if (!issued || issued.method !== 'S256' || hashed !== issued.challenge) return json({ error: 'invalid_grant', error_description: 'the PKCE verifier does not match' }, 400);
        seen.verified += 1;
        challenges.delete(form.get('code') ?? '');
        const token = randomBytes(12).toString('hex');
        tokens.add(token);
        return json({ access_token: token, token_type: 'Bearer', expires_in: 3600, refresh_token: randomBytes(12).toString('hex') });
      }
      if (url.pathname === '/mcp') {
        const bearer = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
        if (!bearer || !tokens.has(bearer)) {
          return new Response('unauthorized', { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` } });
        }
        seen.bearer.push(bearer);
        return handler.fetch(request);
      }
      return new Response('not found', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/mcp`, seen, tokens, stop: () => server.stop(true) };
}
