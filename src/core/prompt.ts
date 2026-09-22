import type { Profile } from '../types/config.js';
import type { McpToolDescriptor } from '../types/mcp.js';

export function buildSystemPrompt(profile?: Profile | null): string {
  const base = profile?.system_prompt_override?.trim() || 'You are JamCLI, a meticulous AI software engineer.';
  const toolGuidance = [
    'TOOL USAGE RULES:',
    '- For commands like run "X": use run_command ONLY, do not list/read/search files first.',
    '- For file/code questions: prefer list_files, read_file, search_code as needed.',
    '- Inspect the repository with tools instead of guessing at its contents.',
    '- To discover other MCP tools: call search_tools.',
    '- If no tool is needed, respond naturally without tool calls.',
    '- Never call multiple tools when one suffices; avoid exploratory calls.',
    '',
    'Examples:',
    '✅ "run \\"ls\\"" -> run_command only',
    '✅ "what is in src/?" -> list_files',
    '✅ "hello" -> no tools',
    '❌ "run \\"ls\\"" -> do not call list_files/read_file/search_code',
  ].join('\n');
  return `${base}\n\n${toolGuidance}`;
}

export function buildToolAvailabilityPrompt(tools: McpToolDescriptor[]): string {
  if (!tools.length) return '';
  const lines = tools.map((tool) => {
    const from = tool.source === 'server' ? `mcp:${tool.serverId}` : 'builtin';
    return `- ${tool.name} (${from}) — ${tool.description || 'no description'}`;
  });
  return [
    'Available tools for this session (subset shown; more may be discoverable):',
    ...lines,
    'Use tools only when directly needed. Use search_tools to discover other capabilities.',
  ].join('\n');
}
