import type { Profile } from '../../types/config.js';
import type { ToolSummary } from './tools.js';
import { PLAN_NOTE, type PermissionMode } from '../permissions/modes.js';

export interface PromptInputs {
  profile?: Profile | null;
  rulesText?: string;
  tools: ToolSummary[];
  projectRoot: string;
  cwd: string;
  platform?: string;
  date?: Date;
  /** Plan mode adds a note, so the model knows why it can only read. */
  mode?: PermissionMode;
}

const DEFAULT_IDENTITY =
  'You are JamCLI, a coding agent working in the user\'s project. You are precise, you check your work, and you say plainly what you did and did not do.';

/** Guidance that names only the tools this session actually offers. */
const toolGuidance = (tools: ToolSummary[]): string => {
  const has = (name: string) => tools.some((tool) => tool.name === name);
  const lines = ['Working with tools:', '- Inspect the project with tools instead of guessing at its contents.'];
  const finders = ['glob', 'grep'].filter(has);
  if (finders.length) lines.push(`- Find files with ${finders.join(' and ')}, then read what matters with read_file.`);
  if (has('edit')) lines.push('- Read a file before changing it, and prefer edit for changes to existing files.');
  if (has('run_command')) lines.push('- Check your work with the project\'s own tests or build through run_command when you can.');
  lines.push('- When a tool can do something, call it rather than describing the call.');
  lines.push('- If no tool is needed, answer directly.');
  return lines.join('\n');
};

/**
 * The system prompt every surface sends: the profile's instructions, the project's rules,
 * guidance for the offered tools, and the facts of the environment.
 */
export function buildRuntimePrompt(inputs: PromptInputs): string {
  const parts = [inputs.profile?.system_prompt_override?.trim() || DEFAULT_IDENTITY];
  const rules = inputs.rulesText?.trim();
  if (rules) parts.push(rules);
  if (inputs.tools.length) parts.push(toolGuidance(inputs.tools));
  if (inputs.mode === 'plan') parts.push(PLAN_NOTE);
  const date = (inputs.date ?? new Date()).toISOString().slice(0, 10);
  parts.push(
    [
      'Environment:',
      `- Project root: ${inputs.projectRoot}`,
      `- Working directory: ${inputs.cwd}`,
      `- Platform: ${inputs.platform ?? process.platform}`,
      `- Date: ${date}`,
    ].join('\n')
  );
  return parts.join('\n\n');
}
