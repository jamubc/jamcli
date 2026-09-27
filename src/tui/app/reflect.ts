import { loadSkills } from '../../core/ext/skills.js';
import { REFLECT_SKILL, REFLECTION_TOOLS, reflectTurn } from '../../core/reflection/index.js';
import type { SlashCommand } from './commands.js';

export const reflect: SlashCommand = {
  name: 'reflect',
  args: '[focus]',
  summary: 'Learn from what went wrong in this session, as edits you approve',
  source: 'built-in',
  run(ctx, args) {
    const ownSkill = loadSkills(ctx.projectRoot).skills.some((skill) => skill.name === REFLECT_SKILL);
    ctx.send(reflectTurn(ownSkill, args), { display: `/reflect${args ? ` ${args}` : ''}`, label: '/reflect', offer: REFLECTION_TOOLS });
  },
};
