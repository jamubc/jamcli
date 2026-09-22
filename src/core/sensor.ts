import type { McpToolDescriptor } from '../types/mcp.js';

export type QueryIntent = 'command' | 'code_exploration' | 'conversation';

export function isMcpToolQuery(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    (normalized.includes('mcp') && normalized.includes('tool')) ||
    /^what (tools|mcp tools)/i.test(text.trim()) ||
    /^which (tools|mcp tools)/i.test(text.trim()) ||
    normalized.startsWith('list mcp tool') ||
    normalized.startsWith('show mcp tool')
  );
}

export function detectIntent(text: string): QueryIntent {
  const normalized = text.toLowerCase();
  if (/^(run|execute)\s+['"]?/.test(normalized)) return 'command';
  if (/^(show|list|find|search|read|what is in|open)\b/.test(normalized)) return 'code_exploration';
  if (isMcpToolQuery(text)) return 'code_exploration';
  return 'conversation';
}

export function userQueryNeedsTools(text: string): boolean {
  return detectIntent(text) !== 'conversation';
}

export function selectToolsForQuery(
  tools: McpToolDescriptor[],
  userText: string,
  limit: number = 6
): McpToolDescriptor[] {
  const intent = detectIntent(userText);
  const normalized = userText.toLowerCase();
  const alwaysOn = new Set<string>(['search_tools']);
  if (intent === 'command') {
    return tools.filter((t) => t.name === 'run_command');
  }
  if (intent === 'conversation') {
    return [];
  }

  for (const name of ['read_file', 'search_code', 'list_files']) {
    alwaysOn.add(name);
  }

  const scored: { tool: McpToolDescriptor; score: number }[] = [];

  for (const tool of tools) {
    if (alwaysOn.has(tool.name)) {
      scored.push({ tool, score: 100 });
      continue;
    }

    const haystack = `${tool.name} ${tool.description || ''} ${tool.serverId || ''}`.toLowerCase();
    let score = 0;
    if (haystack.includes('search') || haystack.includes('find')) score += 10;
    if (haystack.includes('file') || haystack.includes('repo') || haystack.includes('code')) score += 10;
    for (const term of normalized.split(/\s+/)) {
      if (term.length > 3 && haystack.includes(term)) {
        score += 2;
      }
    }
    if (score > 0) {
      scored.push({ tool, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const unique = new Map<string, McpToolDescriptor>();
  for (const entry of scored) {
    if (unique.size >= limit) break;
    unique.set(entry.tool.name, entry.tool);
  }
  return Array.from(unique.values());
}
