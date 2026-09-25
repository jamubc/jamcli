import { afterAll, beforeAll, expect, test } from 'bun:test';
import path from 'path';
import { connectMcp, contentText, type ElicitationRequest } from '../connect.js';
import { modernHttpHandler } from '../../../testing/modernMcpServer.js';
import type { McpServerConfig } from '../../../types/mcp.js';

const FIXTURES = path.join(import.meta.dir, '../../../testing');
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
const modernStdio: McpServerConfig = { id: 'modern', command: 'bun', args: [path.join(FIXTURES, 'modernMcpServer.ts')] };
// A server on the 1.x SDK, which speaks only the 2025 handshake.
const legacyStdio: McpServerConfig = { id: 'legacy', command: 'bun', args: [path.join(FIXTURES, 'envMcpServer.ts')] };

let http: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  const handler = modernHttpHandler();
  http = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => handler.fetch(request) });
});
afterAll(() => http.stop(true));

test('a 2.x server is spoken to on 2026-07-28, over stdio and HTTP', async () => {
  for (const server of [modernStdio, { id: 'modern-http', command: '', transport: 'http' as const, url: `http://127.0.0.1:${http.port}/mcp` }]) {
    const connection = await connectMcp(server, { env });
    try {
      expect({ era: connection.era, version: connection.protocolVersion }).toEqual({ era: 'modern', version: '2026-07-28' });
      const tools = await connection.client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(['deploy', 'echo', 'peek']);
      expect(tools.tools.find((tool) => tool.name === 'peek')?.annotations?.readOnlyHint).toBe(true);
      const echoed = await connection.client.callTool({ name: 'echo', arguments: { text: 'hi' } });
      expect(contentText(echoed.content)).toBe('echo:hi');
    } finally {
      await connection.client.close();
    }
  }
}, 20_000);

test('a 2025 server is reached through the fallback handshake, with the same client', async () => {
  const connection = await connectMcp(legacyStdio, { env });
  try {
    expect(connection.era).toBe('legacy');
    expect(connection.protocolVersion).toBe('2025-11-25');
    const tools = await connection.client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(['env_names']);
  } finally {
    await connection.client.close();
  }
}, 20_000);

test('a server\'s request for input reaches the person in either era, and is declined when nobody can answer', async () => {
  const asked: ElicitationRequest[] = [];
  const elicit = async (request: ElicitationRequest) => {
    asked.push(request);
    return { action: 'accept' as const, content: { env: 'staging', confirm: true } };
  };
  for (const server of [modernStdio, { id: 'modern-http', command: '', transport: 'http' as const, url: `http://127.0.0.1:${http.port}/mcp` }]) {
    const connection = await connectMcp(server, { env, elicit });
    try {
      const result = await connection.client.callTool({ name: 'deploy', arguments: {} });
      expect(contentText(result.content)).toBe('deployed to staging, confirmed');
    } finally {
      await connection.client.close();
    }
  }
  expect(asked).toHaveLength(2);
  expect(asked[0]).toMatchObject({ mode: 'form', server: 'modern', message: 'Deploy where?', schema: { required: ['env'], properties: { env: { type: 'string', enum: ['staging', 'production'] } } } });

  const nobody = await connectMcp(modernStdio, { env });
  try {
    expect(contentText((await nobody.client.callTool({ name: 'deploy', arguments: {} })).content)).toBe('not deployed: decline');
  } finally {
    await nobody.client.close();
  }
}, 30_000);

test('prompts and resources come back as text', async () => {
  const connection = await connectMcp(modernStdio, { env });
  try {
    const prompt: any = await connection.client.getPrompt({ name: 'review', arguments: { file: 'a.ts', focus: 'errors' } });
    expect(contentText([prompt.messages[0].content])).toBe('Review a.ts for errors.');
    const read: any = await connection.client.readResource({ uri: 'docs://readme' });
    expect(read.contents[0].text).toBe('README: build with bun.');
  } finally {
    await connection.client.close();
  }
  expect(contentText([{ type: 'resource_link', uri: 'docs://x', name: 'X' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }])).toBe('[resource docs://x: X]\n[image image/png, 4 bytes of base64]');
}, 20_000);
