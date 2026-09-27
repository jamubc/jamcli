// TODO: cross-session reflection (like Claude Code's /insights) is out of scope; see openspec/SEQUENCE.md.
export const REFLECT_SKILL = 'reflect';

export const REFLECT_PROMPT = `Reflect on this session. The aim is understanding, not a fix.

1. Call session_signals. If it reports nothing, say so and stop.
2. For each signal that matters, work out what you believed at that point, what was true, and why they differed. Read the files or output involved if you need to; do not guess.
3. Keep only what would change your behavior next time in a way nothing already written down would. Most sessions teach nothing new; saying so is a good answer.
4. For each lesson you keep, call propose_lesson once: cite the signal ids, choose the narrowest file it belongs in (a skill over AGENTS.md when it is about one kind of task), and write a concrete trigger and action, not advice.
5. End with a short list: each finding with its signal ids, and whether a lesson was proposed, refused by a gate, or not needed.`;

export const reflectTurn = (hasOwnSkill: boolean, focus: string) =>
  [hasOwnSkill ? `Load the ${REFLECT_SKILL} skill and follow it for this session.` : REFLECT_PROMPT, focus ? `\nFocus on: ${focus}` : ''].join('');
