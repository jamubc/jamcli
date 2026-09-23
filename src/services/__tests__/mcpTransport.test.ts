import { test, expect } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createClientTransport, resolveTransportKind } from '../McpManager.js';
import type { McpServerConfig } from '../../types/mcp.js';

type SeenCall = { method: string; url: string; headers: Record<string, string>; body: any };

const httpServer: McpServerConfig = {
  id: 'remote',
  command: '',
  transport: 'http',
  url: 'http://127.0.0.1:9/mcp',
  headers: { authorization: 'Bearer test-token' },
};

test('a server with no transport keeps using stdio', () => {
  expect(resolveTransportKind({ id: 'local', command: 'node', args: ['server.js'] })).toBe('stdio');
});

test('a url-only entry is treated as http', () => {
  expect(resolveTransportKind({ id: 'remote', command: '', url: 'http://localhost/mcp' })).toBe('http');
});

test('a stdio server builds a stdio transport', () => {
  const transport = createClientTransport({ id: 'local', command: 'node', args: ['server.js'] });
  expect(transport).toBeInstanceOf(StdioClientTransport);
});

test('an http server round-trips initialize and tools/list over the streamable transport', async () => {
  const seen: SeenCall[] = [];

  // A stub fetch speaks JSON-RPC over HTTP so the real transport and client
  // exchange real messages with no socket and no live server.
  const stubFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method || 'GET').toUpperCase();
    if (method !== 'POST') {
      return new Response(null, { status: 405 });
    }
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = JSON.parse(String(init?.body));
    seen.push({ method, url: String(url), headers, body });

    if (body.method === 'initialize') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'stub', version: '1.0.0' },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' } }
      );
    }
    if (body.method === 'tools/list') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: [{ name: 'echo', description: 'Echo back', inputSchema: { type: 'object', properties: {} } }] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response(null, { status: 202 });
  };

  const transport = createClientTransport(httpServer, { fetch: stubFetch });
  expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);

  const client = new Client({ name: 'jamcli-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const tools = await client.listTools();
  await client.close();

  expect(tools.tools.map((tool) => tool.name)).toEqual(['echo']);
  const initialize = seen.find((call) => call.body.method === 'initialize');
  expect(initialize).toBeDefined();
  expect(initialize?.headers['authorization']).toBe('Bearer test-token');
  expect(seen.every((call) => call.url === 'http://127.0.0.1:9/mcp')).toBe(true);
});

test('an http server without a url is rejected', () => {
  expect(() => createClientTransport({ id: 'broken', command: '', transport: 'http' })).toThrow(/url/);
});
