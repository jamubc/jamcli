import path from 'path';
import { loadConfig } from '../core/config/load.js';
import { loadCommands, type LoadedCommands } from '../core/ext/commands.js';
import { loadSkills, skillDirs, type LoadedSkills } from '../core/ext/skills.js';
import { HookTrust, hooksDigest, hooksFromLayers, needsTrust, type HookCommand } from '../core/hooks/commands.js';

/**
 * What the extension points hold, as plain text: `jamcli skill list`, `jamcli hooks`, and
 * the interface's /skills, /hooks, and /commands print the same words.
 */

const where = (file: string, projectRoot: string) => {
  const relative = path.relative(projectRoot, file);
  return relative && !relative.startsWith('..') ? relative : file;
};

export function skillsReport(loaded: LoadedSkills, projectRoot: string): string {
  const lines: string[] = [];
  if (!loaded.skills.length) {
    lines.push('No skills. A skill is a directory holding SKILL.md, found in:', ...skillDirs(projectRoot).map((entry) => `  ${where(entry.dir, projectRoot)} (${entry.scope})`));
  } else {
    lines.push(`Skills (${loaded.skills.length}), which the model loads with the skill tool when a task calls for one:`);
    for (const skill of loaded.skills) {
      lines.push(`  ${skill.name} (${skill.scope}): ${skill.description}`);
      lines.push(`    ${where(skill.dir, projectRoot)}${skill.allowedTools ? `; while active, only ${skill.allowedTools.join(', ')}` : ''}`);
    }
  }
  for (const skill of loaded.shadowed) lines.push(`Hidden by a skill of the same name: ${where(skill.dir, projectRoot)}`);
  for (const problem of loaded.problems) lines.push(`Not loaded: ${problem}`);
  return lines.join('\n');
}

export function commandsReport(loaded: LoadedCommands, projectRoot: string): string {
  const lines: string[] = [];
  if (!loaded.commands.length) {
    lines.push('No custom commands. Add a Markdown file to .jamcli/commands/ (this project) or ~/.config/jamcli/commands/ (yours); name.md becomes /name.');
  } else {
    lines.push(`Custom commands (${loaded.commands.length}):`);
    for (const command of loaded.commands) {
      const extras = [command.model ? `on ${command.model}` : '', command.allowedTools ? `only ${command.allowedTools.join(', ')}` : ''].filter(Boolean).join('; ');
      lines.push(`  /${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ''} (${command.scope}): ${command.description ?? ''}`.trimEnd());
      lines.push(`    ${where(command.file, projectRoot)}${extras ? `; ${extras}` : ''}`);
    }
  }
  for (const command of loaded.shadowed) lines.push(`Hidden by another /${command.name}: ${where(command.file, projectRoot)}`);
  for (const problem of loaded.problems) lines.push(`Not loaded: ${problem}`);
  return lines.join('\n');
}

export function hooksReport(hooks: HookCommand[], projectTrusted: boolean): string {
  if (!hooks.length) return 'No hooks. Add them under hooks in a configuration file, by event: session_start, user_prompt_submit, pre_tool, post_tool, stop, pre_compact, notification, session_end.';
  const lines = [`Hooks (${hooks.length}):`];
  for (const hook of hooks) {
    const state = hook.enabled === false ? 'disabled' : needsTrust(hook) && !projectTrusted ? 'not trusted, so not run' : 'runs';
    lines.push(`  ${hook.event}${hook.matcher ? ` ${hook.matcher}` : ''}: ${hook.command}`);
    lines.push(`    ${hook.source}; ${state}${hook.timeout_ms ? `; stopped after ${hook.timeout_ms} ms` : ''}`);
  }
  if (hooks.some(needsTrust) && !projectTrusted) lines.push('', 'This project\'s hooks run once you trust them: /hooks trust, or jamcli hooks trust. Trust lapses when they change.');
  return lines.join('\n');
}

/** The configured hooks and whether the project's are trusted, without starting a session. */
export function projectHooks(projectRoot: string): { hooks: HookCommand[]; projectTrusted: boolean; digest: string } {
  const hooks = hooksFromLayers(loadConfig({ projectRoot }).layers);
  const digest = hooksDigest(hooks);
  return { hooks, digest, projectTrusted: !hooks.some(needsTrust) || new HookTrust().isTrusted(projectRoot, digest) };
}

type Io = { out: (line: string) => void; err: (line: string) => void };
const stdio: Io = { out: (line) => process.stdout.write(`${line}\n`), err: (line) => process.stderr.write(`${line}\n`) };

export const SKILL_USAGE = 'Usage: jamcli skill list';
export const HOOKS_USAGE = 'Usage: jamcli hooks [list|trust]';

/** `jamcli skill list`. */
export async function runSkillCommand(args: string[], projectRoot: string, io: Io = stdio): Promise<number> {
  if (args[0] !== 'list' && args.length) {
    io.err(SKILL_USAGE);
    return 2;
  }
  io.out(skillsReport(loadSkills(projectRoot), projectRoot));
  return 0;
}

/** `jamcli hooks`, `jamcli hooks list`, and `jamcli hooks trust`. */
export async function runHooksCommand(args: string[], projectRoot: string, io: Io = stdio): Promise<number> {
  const action = args[0] ?? 'list';
  const found = projectHooks(projectRoot);
  if (action === 'list') {
    io.out(hooksReport(found.hooks, found.projectTrusted));
    return 0;
  }
  if (action === 'trust') {
    if (!found.hooks.some(needsTrust)) {
      io.out('This project configures no hooks, so there is nothing to trust.');
      return 0;
    }
    new HookTrust().trust(projectRoot, found.digest);
    io.out(`Trusted this project's ${found.hooks.filter(needsTrust).length} hook(s) as they are now. They run from the next session.`);
    return 0;
  }
  io.err(HOOKS_USAGE);
  return 2;
}
