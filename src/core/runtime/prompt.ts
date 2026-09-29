import type { Profile } from '../../types/config.js';
import type { ToolSummary } from './tools.js';
import type { PermissionMode } from '../permissions/modes.js';

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
  /** How the project checks itself, and what the harness runs of it, in one sentence. */
  gates?: string;
  /** `provider:model` of the session, so the model knows which one it is and when that changes. */
  model?: string;
}

const DEFAULT_IDENTITY =
  'You are JamCLI, a coding agent working in the user\'s project. You are precise, you check your work, and you say plainly what you did and did not do.';

const offers = (tools: ToolSummary[]) => (name: string) => tools.some((tool) => tool.name === name);

/** Guidance that names only the tools this session actually offers. The todo list and ask_user carry their own rules in their descriptions. */
const toolGuidance = (tools: ToolSummary[], gates?: string): string => {
  const has = offers(tools);
  const lines = ['Working with tools:', '- Inspect the project with tools instead of guessing at its contents.'];
  const readers = ['read_file', 'grep', 'glob'].filter(has);
  const finders = ['glob', 'grep'].filter(has);
  if (finders.length) lines.push(`- Find files with ${finders.join(' and ')}, then read what matters with read_file.`);
  if (readers.length && has('run_command')) {
    lines.push(`- Read, search, and list with ${readers.join(', ')}. They never ask. Use run_command for commands, not for reading files or listing directories.`);
  }
  if (has('edit')) lines.push('- Read a file once, then make every change to it in one edit. Re-read only what an error says changed.');
  if (has('run_command')) {
    lines.push(gates ? '- A step is done when its check ran and passed. Say what ran and what it showed. If a gate fails, fix it before saying anything is done.' : '- Check your work with the project\'s own tests or build through run_command when you can.');
    lines.push('- A server, a watcher, or anything that does not exit on its own runs with background: true. Read it with command_output and stop it with command_kill; you are told when it ends. Never wait on it in the foreground.');
  }
  lines.push('- A result that reads "withheld by the trust gate" was removed by a screen on tool output, not by chance. Ask for it another way, or tell the person.');
  lines.push('- When a note says the model or the mode changed, the messages above it were written under the old one. Do not describe them as errors.');
  lines.push('- When a tool can do something, call it rather than describing the call.');
  lines.push('- If no tool is needed, answer directly.');
  if (gates) lines.push('', gates);
  return lines.join('\n');
};

/**
 * What plan mode is and how to work in it. The harness enforces the mode: this note only
 * describes it, and names a tool only when the session offers it.
 */
export const planNote = (tools: ToolSummary[]): string => {
  const has = offers(tools);
  const ask = has('ask_user')
    ? 'Ask the person with ask_user about a requirement that reads two ways, a choice between designs, or an irreversible step.'
    : 'Ask the person, by ending your turn with the question, about a requirement that reads two ways, a choice between designs, or an irreversible step.';
  const write = has('plan_write')
    ? 'Save the plan with plan_write'
    : 'Present the plan in your reply';
  const exit = has('exit_plan_mode')
    ? 'Then call exit_plan_mode. The person sees the plan and approves it, or declines it with feedback you act on. Approval ends plan mode from the next turn; until then change nothing, and never say a change was made.'
    : 'Then stop. The person approves by switching the mode and telling you to proceed. Never say a change was made.';
  return [
    'Plan mode is on. Investigate, then present a plan for the person to approve. Do not implement.',
    '',
    'What this session can do:',
    '- Read and search the project. Tools that change files, run commands, or delegate are not offered, and any attempt is refused before it runs. Do not work around this.',
    '- Tools that reach the network ask the person first.',
    ...(has('plan_write') ? ['- plan_write saves the plan to .jamcli/plan.md, where the person can read and edit it; read_file reads it back. It is the one file you may write.'] : []),
    '',
    'Triage before planning:',
    '- A question ("how does X work", "where is Y") gets a direct answer. No plan.',
    '- A request to change something gets the plan below.',
    '',
    'Making the plan:',
    '1. Read the code paths the change touches, and audit what the project already has before proposing anything new. An existing helper, pattern, or dependency beats a reimplementation.',
    `2. Decide what you can and escalate only what you cannot. State a routine assumption in the plan. ${ask} Stop and report when the request cannot be done as asked.`,
    "3. Choose one approach that follows the project's existing patterns. Do not present alternatives.",
    `4. ${write}: the goal in one line; the assumptions; numbered steps in dependency order, each naming the files it touches by path, what it must keep working, and the check that proves it done (a test, a command, or what to look at: code that exists is not a step done); anything the person must supply, such as a real credential, never a placeholder; and how each failure a step handles reaches the person.`,
    ...(has('todo_write') ? ['5. Put the steps into the todo list with todo_write, one item per step with its check, all pending. It is kept in the project and read back after the mode changes.'] : []),
    `${has('todo_write') ? 6 : 5}. ${exit}`,
  ].join('\n');
};

/**
 * The system prompt every surface sends: the profile's instructions, the project's rules,
 * guidance for the offered tools, and the facts of the environment. It changes only when
 * the tools, the rules, the mode, or the model do, so a provider's cache holds across steps.
 */
export function buildRuntimePrompt(inputs: PromptInputs): string {
  const parts = [inputs.profile?.system_prompt_override?.trim() || DEFAULT_IDENTITY];
  const rules = inputs.rulesText?.trim();
  if (rules) parts.push(rules);
  if (inputs.tools.length) parts.push(toolGuidance(inputs.tools, inputs.gates));
  if (inputs.mode === 'plan') parts.push(planNote(inputs.tools));
  // The person's own date: the UTC one is tomorrow in an American evening and yesterday in an Asian morning.
  const now = inputs.date ?? new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  parts.push(
    [
      'Environment:',
      `- Project root: ${inputs.projectRoot}`,
      `- Working directory: ${inputs.cwd}`,
      `- Platform: ${inputs.platform ?? process.platform}`,
      `- Date: ${date}`,
      ...(inputs.model ? [`- Model: ${inputs.model}`] : []),
    ].join('\n')
  );
  return parts.join('\n\n');
}
