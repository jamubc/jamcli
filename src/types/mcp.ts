export type McpTransport = 'stdio' | 'sse' | 'http';

export interface McpServerConfig {
  id: string;
  title?: string;
  /**
   * Required for stdio servers. HTTP servers carry an empty string so that
   * every existing entry keeps the same shape; the transport field selects
   * which fields are actually used.
   */
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  transport?: McpTransport;
  /** Endpoint for the streamable HTTP transport. */
  url?: string;
  /** Extra request headers for the streamable HTTP transport. */
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: any;
  source: 'builtin' | 'server';
  serverId?: string;
  serverTitle?: string;
  nativeName?: string;
  annotations?: {
    destructiveHint?: boolean;
    readOnlyHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface McpTestResult {
  status: 'ok' | 'failed';
  message: string;
  latencyMs?: number;
  timestamp: number;
  toolCount?: number;
}
