import type { RegisteredTool } from '../../types/tools.js';

/** A tool whose schema is held back until the model asks for it. */
export interface SearchableTool {
  name: string;
  description: string;
  /** The MCP server it comes from. */
  server?: string;
}

/** Tools offered through search once MCP servers bring more than this many. */
export const DEFAULT_TOOL_SEARCH_THRESHOLD = 40;

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Rank tools against a query: a word in the tool's name counts more than a word in its
 * description, and a tool that matches no word is left out.
 */
export function searchTools(tools: SearchableTool[], query: string, limit = 5): SearchableTool[] {
  const wanted = words(query);
  if (!wanted.length) return [];
  const scored = tools.map((tool) => {
    const name = new Set(words(tool.name));
    const description = new Set(words(tool.description));
    let score = 0;
    for (const word of wanted) {
      if (name.has(word)) score += 3;
      else if ([...name].some((part) => part.startsWith(word))) score += 2;
      if (description.has(word)) score += 1;
    }
    return { tool, score };
  });
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, limit)
    .map((entry) => entry.tool);
}

export interface ToolSearchOptions {
  /** The tools still held back. */
  deferred: () => SearchableTool[];
  /** Offer these tools from the next request on. */
  load: (names: string[]) => void;
}

/**
 * `search_tools`: when MCP servers bring more tools than fit well in every request, their
 * schemas are held back, and the model finds and loads the ones it needs. `select:a,b`
 * loads tools by exact name.
 */
export function toolSearchTool(options: ToolSearchOptions): RegisteredTool {
  return {
    name: 'search_tools',
    description:
      'Find tools from the connected MCP servers that are not listed yet, by what they do, and make the matches available from your next step. Use "select:name1,name2" to load tools by exact name.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words describing the tool you need, or "select:" and exact names separated by commas.' },
        limit: { type: 'number', description: 'How many tools to load at most. Defaults to 5.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    policy: 'read',
    runner: async (args) => {
      const query = String(args.query ?? '').trim();
      const deferred = options.deferred();
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 20) : 5;
      const found = query.startsWith('select:')
        ? query
            .slice('select:'.length)
            .split(',')
            .map((name) => name.trim())
            .flatMap((name) => deferred.filter((tool) => tool.name === name))
        : searchTools(deferred, query, limit);
      if (!found.length) {
        return { output: `No tool that is not listed yet matches "${query}". ${deferred.length} tools are held back.`, metadata: { loaded: 0 } };
      }
      options.load(found.map((tool) => tool.name));
      return {
        output: [
          'These tools are available from your next step:',
          ...found.map((tool) => `- ${tool.name}${tool.server ? ` (MCP server ${tool.server})` : ''}: ${tool.description}`),
        ].join('\n'),
        metadata: { loaded: found.length },
      };
    },
  };
}
