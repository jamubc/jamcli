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

/**
 * The session up to the request to reflect. That request is the last person's message, and
 * following a failure it would otherwise read as a correction of it.
 */
const reflectedOn = (sources: ReflectionSources): TranscriptEvent[] => {
  const events = sources.events();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'message' && event.message.role === 'user') return events.slice(0, index);
  }
  return events;
};

/**
 * The tester notes a reflection reads, with how the person framed them: the last
 * `reflection` event decides, and one that left the notes out, or none at all, gives none.
 */
export function framedNotes(events: TranscriptEvent[]): { framing: string; notes: Signal[] } | undefined {
  const framed = [...events].reverse().find((event): event is Extract<TranscriptEvent, { type: 'reflection' }> => event.type === 'reflection');
  if (!framed?.notes) return undefined;
  const notes = events.flatMap((event, id): Signal[] =>
    event.type === 'note' ? [{ id, kind: 'note', detail: event.text, confidence: 'high', signature: `note/-/-/${id}` }] : []
  );
  return notes.length ? { framing: framed.notes, notes } : undefined;
}

/** What a lesson may cite: the failures, and the notes the person framed. */
const citable = (events: TranscriptEvent[]): Signal[] => [...signalsOf(events), ...(framedNotes(events)?.notes ?? [])];

export const lessonFor = (sources: ReflectionSources, args: Record<string, unknown>) =>
  planLesson(args as unknown as LessonArgs, { projectRoot: sources.projectRoot, signals: citable(reflectedOn(sources)), known: sources.known() });

/** The tools a reflection turn is offered; no other turn sees them. */
export const REFLECTION_TOOLS = ['session_signals', 'propose_lesson'];

export function reflectionTools(sources: ReflectionSources): RegisteredTool[] {
  return [
    {
      name: 'session_signals',
      description: "What went wrong in this session, read from its log: tool errors, retries, denials, cancellations, likely corrections, and waste, each with an id to cite and what the model had said just before. When the person framed the session's tester notes for this reflection, they follow, each with an id to cite.",
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      policy: 'read',
      runner: async () => {
        const events = reflectedOn(sources);
        const signals = signalsOf(events);
        const framed = framedNotes(events);
        const parts = [signals.length ? signals.map((signal) => describe(events, signal)).join('\n') : 'This session has no signals: nothing failed, was denied, or was cancelled.'];
        if (framed) {
          parts.push(
            `Tester notes, which the person planted while using JamCLI and framed for this reflection as: ${framed.framing}\n` +
              framed.notes.map((note) => `[${note.id}] note: ${note.detail}`).join('\n')
          );
        }
        return { output: parts.join('\n\n') };
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
