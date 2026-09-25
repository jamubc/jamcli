import type { RegisteredTool } from '../../types/tools.js';
import { ACP_TOOLS } from './acp.js';
import { ALIAS_TOOLS } from './aliases.js';
import { COMMAND_TOOLS } from './command.js';
import { EDIT_TOOL } from './edit.js';
import { GIT_COMMIT_TOOL, GIT_TOOLS } from './git.js';
import { GLOB_TOOL } from './glob.js';
import { GREP_TOOL } from './grep.js';
import { APPLY_PATCH_TOOL } from './patch.js';
import { READ_FILE_TOOL } from './read_file.js';
import { TASK_TOOLS } from './task.js';
import { TODO_TOOLS } from './todo.js';
import { WEB_FETCH_TOOL } from './webFetch.js';
import { WRITE_FILE_TOOL } from './write_file.js';

/** Every built-in tool, one per job, plus the hidden aliases that keep older names working. */
export const BUILTIN_TOOLS: RegisteredTool[] = [
  READ_FILE_TOOL,
  GLOB_TOOL,
  GREP_TOOL,
  WRITE_FILE_TOOL,
  EDIT_TOOL,
  APPLY_PATCH_TOOL,
  ...COMMAND_TOOLS,
  ...TODO_TOOLS,
  ...GIT_TOOLS,
  GIT_COMMIT_TOOL,
  WEB_FETCH_TOOL,
  ...TASK_TOOLS,
  ...ACP_TOOLS,
  ...ALIAS_TOOLS,
];

export function registerBuiltinTools(registry: { register(tool: RegisteredTool): void }): void {
  for (const tool of BUILTIN_TOOLS) {
    registry.register(tool);
  }
}
