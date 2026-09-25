import { Client, StreamableHTTPClientTransport, type OAuthClientProvider, type Transport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { McpServerConfig } from '../../types/mcp.js';
import { JAMCLI_VERSION } from '../version.js';

/**
 * One connection to an MCP server on the 2.x client (D20). The client asks with
 * `server/discover` first and speaks the 2026-07-28 revision when the server does; any
 * other answer falls back to the 2025 `initialize` handshake, so older servers keep
 * working through the same client.
 */

/** What a server asks the person for: a form to fill, or a page to open. */
export type ElicitationRequest =
  | { mode: 'form'; server: string; message: string; schema: { properties: Record<string, ElicitField>; required?: string[] } }
  | { mode: 'url'; server: string; message: string; url: string; id?: string };

export interface ElicitField {
  type: 'string' | 'number' | 'integer' | 'boolean';
  title?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  format?: string;
}

/** A form's answers are strings, numbers, booleans, or lists of strings, as the protocol allows. */
export type ElicitValue = string | number | boolean | string[];
export type ElicitationAnswer = { action: 'accept'; content?: Record<string, ElicitValue> } | { action: 'decline' } | { action: 'cancel' };

export interface McpConnectOptions {
  /** The environment a stdio server starts with. */
  env: Record<string, string>;
  /** For HTTP servers that sign in with OAuth. */
  authProvider?: OAuthClientProvider;
  /** Answers a server's request for input. Without one, every request is declined. */
  elicit?: (request: ElicitationRequest) => Promise<ElicitationAnswer>;
  fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
}

export interface McpConnection {
  server: McpServerConfig;
  client: Client;
  transport: Transport;
  /** `modern` for 2026-07-28 and later, `legacy` for the 2025 handshake. */
  era: 'modern' | 'legacy';
  protocolVersion: string;
}

/** stdio unless the entry names HTTP, or gives only a URL. */
export const transportKind = (server: McpServerConfig): 'stdio' | 'http' => {
  if (server.transport === 'http' || server.transport === 'sse') return 'http';
  if (!server.transport && !!server.url && !server.command) return 'http';
  return 'stdio';
};

export function createTransport(server: McpServerConfig, options: Pick<McpConnectOptions, 'env' | 'authProvider' | 'fetch'>): Transport {
  if (transportKind(server) === 'http') {
    if (!server.url) throw new Error(`MCP server ${server.id} declares an HTTP transport without a url.`);
    return new StreamableHTTPClientTransport(new URL(server.url), {
      ...(server.headers ? { requestInit: { headers: server.headers } } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.authProvider ? { authProvider: options.authProvider } : {}),
    });
  }
  return new StdioClientTransport({ command: server.command, args: server.args ?? [], env: options.env, cwd: server.cwd || process.cwd(), stderr: 'ignore' });
}

/** Connect, negotiating the protocol revision, with elicitation answered through `elicit`. */
export async function connectMcp(server: McpServerConfig, options: McpConnectOptions): Promise<McpConnection> {
  const client = new Client(
    { name: 'jamcli', version: JAMCLI_VERSION },
    { capabilities: { elicitation: { form: {}, url: {} } }, versionNegotiation: { mode: 'auto' } }
  );
  client.setRequestHandler('elicitation/create', async (request: any) => {
    const params = request.params ?? {};
    if (!options.elicit) return { action: 'decline' };
    const asked: ElicitationRequest =
      params.mode === 'url'
        ? { mode: 'url', server: server.id, message: String(params.message ?? ''), url: String(params.url ?? ''), ...(params.elicitationId ? { id: params.elicitationId } : {}) }
        : { mode: 'form', server: server.id, message: String(params.message ?? ''), schema: { properties: params.requestedSchema?.properties ?? {}, required: params.requestedSchema?.required } };
    return options.elicit(asked);
  });
  const transport = createTransport(server, options);
  await client.connect(transport);
  return {
    server,
    client,
    transport,
    era: client.getProtocolEra() === 'modern' ? 'modern' : 'legacy',
    protocolVersion: client.getNegotiatedProtocolVersion() ?? 'unknown',
  };
}

/** A tool result's content as text for the model. */
export function contentText(content: unknown): string {
  if (!content) return '<empty>';
  if (!Array.isArray(content)) return typeof content === 'string' ? content : JSON.stringify(content);
  return content
    .map((entry: any) => {
      if (entry?.type === 'text' && typeof entry.text === 'string') return entry.text;
      if (entry?.type === 'resource' && typeof entry.resource?.text === 'string') return entry.resource.text;
      if (entry?.type === 'resource_link') return `[resource ${entry.uri}${entry.name ? `: ${entry.name}` : ''}]`;
      if (entry?.type === 'image' || entry?.type === 'audio') return `[${entry.type} ${entry.mimeType ?? ''}, ${String(entry.data ?? '').length} bytes of base64]`;
      return typeof entry === 'string' ? entry : JSON.stringify(entry);
    })
    .join('\n');
}
