import fs from 'fs';
import path from 'path';
import { createTwoFilesPatch } from 'diff';
import { resolveProjectPath } from '../tools/paths.js';
import type { Signal } from './signals.js';


export interface LessonArgs {
  finding: string;
  cites: number[];
  file: string;
  section: string;
  add: string;
}

export interface PlannedLesson {
  target: string;
  relative: string;
  before: string;
  after: string;
  diff: string;
  warning?: string;
}

export type LessonPlan = { ok: true; lesson: PlannedLesson } | { ok: false; reason: string };

const RESTATED = 0.8;
const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'when', 'then', 'than', 'into', 'only', 'before', 'after', 'always', 'never', 'should', 'must', 'use', 'not', 'are', 'was', 'its', 'any']);

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9_.\-/]{3,}/g)?.filter((word) => !STOP.has(word)) ?? []);

export function restatedBy(text: string, known: string[]): string | undefined {
  const added = words(text);
  if (!added.size) return undefined;
  for (const block of known.flatMap((passage) => passage.split(/\n\s*\n/))) {
    const have = words(block);
    let shared = 0;
    for (const word of added) if (have.has(word)) shared += 1;
    if (shared / added.size >= RESTATED) return block.trim();
  }
  return undefined;
}

export function appendUnder(before: string, section: string, add: string): string {
  const lines = before.split('\n');
  const heading = lines.findIndex((line) => /^#{1,6}\s/.test(line) && line.replace(/^#{1,6}\s+/, '').trim().toLowerCase() === section.trim().toLowerCase());
  const block = add.trim();
  if (heading < 0) return `${before.trimEnd()}${before.trim() ? '\n\n' : ''}## ${section.trim()}\n\n${block}\n`;
  let end = lines.findIndex((line, index) => index > heading && /^#{1,6}\s/.test(line));
  if (end < 0) end = lines.length;
  while (end > heading + 1 && lines[end - 1].trim() === '') end -= 1;
  const rest = lines.slice(end);
  const gap = rest.length && rest[0].trim() !== '' ? [''] : [];
  return [...lines.slice(0, end), block, ...gap, ...rest].join('\n').replace(/\n*$/, '\n');
}

export function planLesson(args: LessonArgs, context: { projectRoot: string; signals: Signal[]; known: string[] }): LessonPlan {
  const cites = Array.isArray(args.cites) ? args.cites : [];
  if (!cites.length) return { ok: false, reason: 'A lesson must cite the signals it rests on, by id. Call session_signals for them.' };
  const ids = new Set(context.signals.map((signal) => signal.id));
  const unknown = cites.filter((id) => !ids.has(id));
  if (unknown.length) return { ok: false, reason: `No signal of this session has id ${unknown.join(', ')}. Cite only ids session_signals returned.` };
  if (!String(args.add ?? '').trim()) return { ok: false, reason: 'A lesson must add something.' };
  if (!String(args.section ?? '').trim()) return { ok: false, reason: 'A lesson must name the heading it goes under.' };
  const relative = String(args.file ?? '');
  if (!relative.endsWith('.md')) return { ok: false, reason: 'A lesson may only change a markdown file: AGENTS.md, a rules file, a SKILL.md, or an agent file.' };

  let lesson: PlannedLesson;
  try {
    lesson = draftLesson(context.projectRoot, args);
  } catch (error: any) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
  const echo = restatedBy(args.add, [...context.known, lesson.before]);
  if (echo) return { ok: false, reason: `Already written down, so not a lesson:\n${echo.slice(0, 400)}` };
  return { ok: true, lesson };
}

export function draftLesson(projectRoot: string, args: Pick<LessonArgs, 'file' | 'section' | 'add'>): PlannedLesson {
  const relative = String(args.file ?? '');
  const target = resolveProjectPath(projectRoot, relative);
  const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const after = appendUnder(before, String(args.section ?? ''), String(args.add ?? ''));
  const diff = createTwoFilesPatch(relative, relative, before, after, '', '', { context: 3 });
  return { target, relative, before, after, diff, warning: skillWarning(target) };
}

function skillWarning(target: string): string | undefined {
  if (path.basename(target) !== 'SKILL.md') return undefined;
  const dir = path.dirname(target);
  const bundles = fs.existsSync(dir) && fs.readdirSync(dir).some((entry) => entry !== 'SKILL.md' && !entry.startsWith('.'));
  const narrows = fs.existsSync(target) && /^allowed-tools\s*:/m.test(fs.readFileSync(target, 'utf8'));
  if (!bundles && !narrows) return undefined;
  return 'This skill bundles files or sets allowed-tools: check that the lesson keeps its safety limits.';
}
