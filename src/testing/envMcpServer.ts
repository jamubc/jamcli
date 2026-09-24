import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/** A stdio MCP server for tests: its one tool lists the environment variable names it sees. */
const server = new McpServer({ name: 'env-reporter', version: '1.0.0' });
server.registerTool('env_names', { description: 'List the environment variable names this server sees.' }, async () => ({
  content: [{ type: 'text', text: JSON.stringify(Object.keys(process.env).sort()) }],
}));
await server.connect(new StdioServerTransport());
