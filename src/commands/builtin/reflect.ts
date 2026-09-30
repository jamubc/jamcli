import { loadSkills } from '../../core/ext/skills.js';
import { REFLECT_SKILL, REFLECTION_TOOLS, reflectTurn } from '../../core/reflection/index.js';
import type { SlashCommand } from '../types.js';

/** How a person may frame their tester notes for a reflection, besides their own words. */
const framings = (model: string) => [
  { key: 'features', label: 'Ideas for new JamCLI features', value: 'ideas for new features in JamCLI' },
  { key: 'model', label: `Concerns about how ${model} behaved`, value: `concerns about how the model ${model} behaved` },
  { key: 'bugs', label: 'Bugs in JamCLI itself', value: 'bugs in JamCLI itself' },
  { key: 'out', label: 'Leave the notes out', detail: 'the reflection reads only what failed' },
];

export const reflect: SlashCommand = {
  name: 'reflect',
  args: '[focus]',
  summary: 'Learn from what went wrong in this session, and from your notes as you frame them, as edits you approve',
  source: 'built-in',
  run(ctx, args) {
    const ownSkill = loadSkills(ctx.projectRoot).skills.some((skill) => skill.name === REFLECT_SKILL);
    const start = (framing: string | null) =>
      ctx.send(reflectTurn(ownSkill, args, framing ?? undefined), {
        display: `/reflect${args ? ` ${args}` : ''}`,
        label: '/reflect',
        offer: REFLECTION_TOOLS,
        reflection: { notes: framing },
      });
    const notes = ctx.runtime.notes().length;
    if (!notes) return start(null);
    // The notes are the person's words about what they saw, so they say how the notes are read, or that they are not, before the model sees one.
    // Headless answers it with --choose; a lesson drawn from the notes still asks the person every time.
    ctx.choose({
      title: `How should the reflection read your ${notes} tester note${notes === 1 ? '' : 's'}?`,
      items: framings(`${ctx.runtime.model.provider}:${ctx.runtime.model.model}`),
      freeText: 'say what they are in your own words',
      empty: 'No choices.',
      hint: '/notes lists them first',
      choose: (item) => {
        // Enter on the empty typed row is no answer, not a choice to leave the notes out.
        if (item.key === '__typed__' && !item.value?.trim()) return ctx.notice('info', 'Nothing was typed, so the reflection did not start. /reflect asks again.');
        start(item.key === 'out' ? null : item.key === '__typed__' ? item.value!.trim() : (item.value ?? item.label));
      },
    });
  },
};
