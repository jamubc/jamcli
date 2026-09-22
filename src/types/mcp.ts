export type McpTransport = 'stdio' | 'sse';

export interface McpServerConfig {
  id: string;
  title?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  transport?: McpTransport;
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
