import { test, expect } from 'bun:test';
import { buildSystemPrompt, buildToolAvailabilityPrompt } from '../prompt.js';
import type { McpToolDescriptor } from '../../types/mcp.js';
import type { Profile } from '../../types/config.js';

const profile = (override?: string): Profile => ({
  name: 'test',
  system_prompt_override: override ?? '',
  preferred_model: 'm',
  preferred_provider: 'ollama',
  temperature: 0.5,
});

const tools: McpToolDescriptor[] = [
  { name: 'list_files', description: 'List files', source: 'builtin' },
  { name: 'ext__search', description: 'External search', source: 'server', serverId: 'ext' },
];

test('the core system prompt is byte-identical for an unchanged profile', async () => {
  const src = await Bun.file('src/components/Layout.tsx').text();
  expect(src).not.toContain('TOOL_INSTRUCTION_PROMPT');
  expect(src).not.toContain('const buildSystemPrompt');
  const prompt = buildSystemPrompt(profile());
  expect(prompt).toBe(
    'You are JamCLI, a meticulous AI software engineer.\n\n' +
      'TOOL USAGE RULES:\n' +
      '- For commands like run "X": use run_command ONLY, do not list/read/search files first.\n' +
      '- For file/code questions: prefer list_files, read_file, search_code as needed.\n' +
      '- Inspect the repository with tools instead of guessing at its contents.\n' +
      '- To discover other MCP tools: call search_tools.\n' +
      '- If no tool is needed, respond naturally without tool calls.\n' +
      '- Never call multiple tools when one suffices; avoid exploratory calls.\n' +
      '\n' +
      'Examples:\n' +
      '✅ "run \\"ls\\"" -> run_command only\n' +
      '✅ "what is in src/?" -> list_files\n' +
      '✅ "hello" -> no tools\n' +
      '❌ "run \\"ls\\"" -> do not call list_files/read_file/search_code'
  );
  expect(buildSystemPrompt(profile('Custom base.')).startsWith('Custom base.\n\nTOOL')).toBe(true);
  expect(buildToolAvailabilityPrompt([])).toBe('');
  const availability = buildToolAvailabilityPrompt(tools);
  expect(availability).toContain('- list_files (builtin)');
  expect(availability).toContain('- ext__search (mcp:ext)');
});
