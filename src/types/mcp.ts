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
}
