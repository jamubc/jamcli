import type { RegisteredTool } from '../../types/tools.js';
import { readSkillFile, skillFiles, skillInstructions, type Skill } from '../ext/skills.js';

export interface SkillToolOptions {
  skills: Skill[];
  /**
   * Called when a skill is loaded, so its `allowed-tools` narrow what may run for the rest
   * of the turn. Returns what to tell the model about it.
   */
  activate?: (skill: Skill) => string | undefined;
}

/**
 * The second level of disclosure: a skill's instructions and the files it bundles, or
 * one of those files. Bundled scripts are not run here; the model runs them through
 * `run_command`, where the permission engine and the sandbox apply.
 */
export function skillTool(options: SkillToolOptions): RegisteredTool {
  const names = options.skills.map((skill) => skill.name);
  return {
    name: 'skill',
    description: 'Load a skill\'s instructions and the list of files it bundles, or read one of those files. The system prompt lists the skills.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: names, description: 'The skill to load.' },
        file: { type: 'string', description: 'A file the skill bundles, relative to its directory, to read instead of the instructions.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    policy: 'read',
    runner: async (args) => {
      const skill = options.skills.find((entry) => entry.name === args.name);
      if (!skill) return { output: `There is no skill ${String(args.name)}. The skills are ${names.join(', ')}.`, status: 'error' };
      if (typeof args.file === 'string' && args.file) {
        try {
          return { output: readSkillFile(skill, args.file) };
        } catch (error: any) {
          return { output: error?.message ?? String(error), status: 'error' };
        }
      }
      const files = skillFiles(skill);
      const note = options.activate?.(skill);
      return {
        output: [
          `Skill ${skill.name}, from ${skill.dir}`,
          '',
          skillInstructions(skill),
          ...(files.length
            ? [
                '',
                `Files it bundles, under ${skill.dir}:`,
                ...files.map((file) => `- ${file}`),
                'Read one with the skill tool and its file. Run a bundled script with run_command, by its full path.',
              ]
            : []),
          ...(note ? ['', note] : []),
        ].join('\n'),
        metadata: { skill: skill.name, scope: skill.scope, files: files.length },
      };
    },
  };
}
