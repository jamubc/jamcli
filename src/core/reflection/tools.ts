import fs from 'fs';
import type { RegisteredTool } from '../../types/tools.js';
import type { TranscriptEvent } from '../transcript/events.js';
import { planLesson, type LessonArgs } from './lesson.js';
import { signalsOf, type Signal } from './signals.js';

export interface ReflectionSources {
  projectRoot: string;
  events: () => TranscriptEvent[];
  known: () => string[];
}

const BELIEF_MAX = 300;

const beliefBefore = (events: TranscriptEvent[], id: number): string | undefined => {
  for (let index = id - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'message' && event.message.role === 'assistant' && event.message.content.trim()) {
      const text = event.message.content.replace(/\s+/g, ' ').trim();
      return text.length > BELIEF_MAX ? `${text.slice(0, BELIEF_MAX - 3)}...` : text;
    }
  }
  return undefined;
};

const describe = (events: TranscriptEvent[], signal: Signal) => {
  const belief = beliefBefore(events, signal.id);
  return [`[${signal.id}] ${signal.kind}${signal.confidence === 'low' ? ' (low confidence)' : ''}: ${signal.detail}`, ...(belief ? [`    model had said: ${belief}`] : [])].join('\n');
};

export const lessonFor = (sources: ReflectionSources, args: Record<string, unknown>) =>
  planLesson(args as unknown as LessonArgs, { projectRoot: sources.projectRoot, signals: signalsOf(sources.events()), known: sources.known() });

/** The tools a reflection turn is offered; no other turn sees them. */
export const REFLECTION_TOOLS = ['session_signals', 'propose_lesson'];

export function reflectionTools(sources: ReflectionSources): RegisteredTool[] {
  return [
    {
      name: 'session_signals',
      description: "What went wrong in this session, read from its log: tool errors, retries, denials, cancellations, likely corrections, and waste, each with an id to cite and what the model had said just before.",
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      policy: 'read',
      runner: async () => {
        const events = sources.events();
        const signals = signalsOf(events);
        if (!signals.length) return { output: 'This session has no signals: nothing failed, was denied, or was cancelled.' };
        return { output: signals.map((signal) => describe(events, signal)).join('\n') };
      },
    },
    {
      name: 'propose_lesson',
      description:
        'Propose one lesson from this session: lines added under one heading of one markdown file (AGENTS.md, a rules file, a SKILL.md, or an agent file). It must cite session_signals ids; a lesson that restates what is already written is refused. The person sees the diff and decides.',
      inputSchema: {
        type: 'object',
        properties: {
          finding: { type: 'string', description: 'What was believed, what was true, and why they differed.' },
          cites: { type: 'array', items: { type: 'integer' }, description: 'The session_signals ids this rests on.' },
          file: { type: 'string', description: 'The markdown file to add to, relative to the project root.' },
          section: { type: 'string', description: 'The heading to add under; created at the end if absent.' },
          add: { type: 'string', description: 'The lines to add: a concrete trigger and what to do.' },
        },
        required: ['finding', 'cites', 'file', 'section', 'add'],
        additionalProperties: false,
      },
      policy: 'write',
      alwaysAsks: true,
      runner: async (args) => {
        const plan = lessonFor(sources, args);
        if (!plan.ok) return { output: plan.reason, status: 'error' };
        fs.writeFileSync(plan.lesson.target, plan.lesson.after, 'utf8');
        return { output: `Added the lesson to ${plan.lesson.relative} under "${String(args.section)}".` };
      },
    },
  ];
}
