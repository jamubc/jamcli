import fs from 'fs';
import path from 'path';
import { ensureProjectStateDir } from './log.js';
import { historyDirFor } from './sessions.js';

/**
 * The text the person has typed and not sent, kept beside the session so that leaving, a
 * closed terminal, or a crash does not lose it. It is one file per session, rewritten as the
 * person types, and gone once the text is sent or cleared; the session log keeps what was
 * sent and what was cleared. `chips` holds the text a pasted chip in it stands for.
 */
export interface Draft {
  text: string;
  chips: Record<string, string>;
}

/** A draft as the file holds it: the process that owns it, so a live session's is left alone. */
interface DraftFile extends Draft {
  pid: number;
}

export const draftFileFor = (projectRoot: string, id: string): string => path.join(historyDirFor(projectRoot), `${id}.draft`);

/**
 * Write the session's draft. It is written whole to a scrap and renamed over the old one,
 * and it is synchronous, so an exit handler can call it. Nothing to keep removes the file.
 */
export function saveDraft(projectRoot: string, id: string, draft: Draft): void {
  if (!draft.text.trim()) return clearDraft(projectRoot, id);
  const file = draftFileFor(projectRoot, id);
  ensureProjectStateDir(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const scrap = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(scrap, JSON.stringify({ pid: process.pid, text: draft.text, chips: draft.chips } satisfies DraftFile));
  fs.renameSync(scrap, file);
}

export function clearDraft(projectRoot: string, id: string): void {
  fs.rmSync(draftFileFor(projectRoot, id), { force: true });
}

/** A file's draft, or nothing when it is not one. */
function readDraftFile(file: string): DraftFile | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw?.pid !== 'number' || typeof raw.text !== 'string') return undefined;
    const chips = raw.chips && typeof raw.chips === 'object' && !Array.isArray(raw.chips) ? Object.fromEntries(Object.entries(raw.chips).filter(([, value]) => typeof value === 'string')) : {};
    return { pid: raw.pid, text: raw.text, chips: chips as Record<string, string> };
  } catch {
    return undefined;
  }
}

/** Whether a process is running. One this user may not signal is running all the same. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

/**
 * Take the draft an earlier session of the project left, if its process has ended: the
 * newest one, once, since a new interface opens a new session and would never meet the
 * draft of the one before. The file is claimed by renaming it, which only one of two starts
 * at once can do. A draft of a session still running, this session's own, and a file that
 * is not a draft are left where they are.
 */
export function adoptOrphanDraft(projectRoot: string, ownId: string): (Draft & { from: string }) | undefined {
  const dir = historyDirFor(projectRoot);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.draft') && name !== `${ownId}.draft`);
  } catch {
    return undefined;
  }
  const candidates = names
    .map((name) => ({ name, file: path.join(dir, name), at: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const { name, file } of candidates) {
    const draft = readDraftFile(file);
    if (!draft || alive(draft.pid)) continue;
    const claimed = `${file}.${process.pid}.taken`;
    try {
      fs.renameSync(file, claimed);
    } catch {
      continue;
    }
    fs.rmSync(claimed, { force: true });
    return { text: draft.text, chips: draft.chips, from: name.slice(0, -'.draft'.length) };
  }
  return undefined;
}
