import { McpServer, createMcpHandler, inputRequired, inputResponse } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

/**
 * A 2.x MCP server for tests, speaking the 2026-07-28 revision and serving 2025 clients
 * too: a tool, a read-only tool, a tool that fails, a tool that asks the person for input,
 * a prompt, and a resource. Run it to serve stdio, or import `modernHttpHandler` to serve HTTP.
 */
export function modernServer(): McpServer {
  const server = new McpServer({ name: 'modern-fixture', version: '2.0.0' });
  server.registerTool('echo', { description: 'Echo the text back.', inputSchema: z.object({ text: z.string() }) }, async ({ text }) => ({
    content: [{ type: 'text' as const, text: `echo:${text}` }],
  }));
  server.registerTool('fail', { description: 'Always fails.' }, async () => ({ content: [{ type: 'text' as const, text: 'boom' }], isError: true }));
  server.registerTool('peek', { description: 'Read something, changing nothing.', annotations: { readOnlyHint: true } }, async () => ({
    content: [{ type: 'text' as const, text: 'peeked' }],
  }));
  // Asks the person where to deploy: pushed as a request on a 2025 connection, and as an
  // input_required answer on a 2026-07-28 one, which the client fulfils and retries.
  server.registerTool('deploy', { description: 'Ask which environment, then deploy.' }, async (ctx) => {
    const request = {
      message: 'Deploy where?',
      requestedSchema: { type: 'object' as const, properties: { env: { type: 'string' as const, enum: ['staging', 'production'] }, confirm: { type: 'boolean' as const } }, required: ['env'] },
    };
    let answer: { action: string; content?: Record<string, unknown> };
    const retried = inputResponse(ctx.mcpReq.inputResponses, 'where');
    if (retried.kind === 'elicit') answer = retried;
    else {
      try {
        answer = await ctx.mcpReq.elicitInput(request);
      } catch {
        return inputRequired({ inputRequests: { where: inputRequired.elicit(request) } });
      }
    }
    const text = answer.action !== 'accept' ? `not deployed: ${answer.action}` : `deployed to ${answer.content?.env}${answer.content?.confirm === true ? ', confirmed' : ''}`;
    return { content: [{ type: 'text' as const, text }] };
  });
  server.registerPrompt('review', { description: 'Review a file.', argsSchema: z.object({ file: z.string(), focus: z.string().optional() }) }, ({ file, focus }) => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Review ${file}${focus ? ` for ${focus}` : ''}.` } }],
  }));
  server.registerResource('readme', 'docs://readme', { description: 'The project readme.', mimeType: 'text/plain' }, async (uri) => ({
    contents: [{ uri: uri.href, text: 'README: build with bun.' }],
  }));
  // Carries a credential from the environment, so tests can prove resource text is redacted.
  server.registerResource('secret', 'probe://secret', { description: 'A resource carrying a credential.', mimeType: 'text/plain' }, async (uri) => ({
    contents: [{ uri: uri.href, text: `DEPLOY_TOKEN=${process.env.JAMCLI_PROBE_SECRET ?? 'unset'}` }],
  }));
  server.registerResource('broken', 'probe://broken', { description: 'A resource whose read always fails.', mimeType: 'text/plain' }, async () => {
    throw new Error('the broken resource cannot be read');
  });
  // Returns text and binary parts together, so tests can prove both reach the prompt.
  server.registerResource('mixed', 'probe://mixed', { description: 'A resource with text and binary parts.' }, async (uri) => ({
    contents: [
      { uri: uri.href, text: 'first part' },
      { uri: uri.href, blob: Buffer.from('png-bytes').toString('base64'), mimeType: 'image/png' },
    ],
  }));
  return server;
}

export const modernHttpHandler = () => createMcpHandler(() => modernServer());

if (import.meta.main) serveStdio(() => modernServer());
