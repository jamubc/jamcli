import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { historyDirFor, readSessionIndex } from '../index.js';
import { adoptOrphanDraft, clearDraft, draftFileFor, saveDraft } from '../draft.js';

let root: string;
let previousState: string | undefined;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-draft-')));
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, 'state');
});

afterEach(() => {
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
});

/** A process id that belonged to a process that has ended. */
const deadPid = (): number => {
  const child = Bun.spawnSync(['true']);
  return child.pid ?? 999_999;
};

const leave = (id: string, text: string, pid: number, chips: Record<string, string> = {}) => {
  fs.mkdirSync(historyDirFor(root), { recursive: true });
  fs.writeFileSync(draftFileFor(root, id), JSON.stringify({ pid, text, chips }));
};

test('a draft is written whole beside the session, with the chips it stands for, and leaves no scrap behind', () => {
  saveDraft(root, 's1', { text: 'a long thought', chips: { '1': 'pasted text' } });
  expect(JSON.parse(fs.readFileSync(draftFileFor(root, 's1'), 'utf8'))).toEqual({ pid: process.pid, text: 'a long thought', chips: { '1': 'pasted text' } });
  saveDraft(root, 's1', { text: 'a longer thought', chips: {} });
  expect(JSON.parse(fs.readFileSync(draftFileFor(root, 's1'), 'utf8')).text).toBe('a longer thought');
  expect(fs.readdirSync(historyDirFor(root))).toEqual(['s1.draft']);
  // The state directory keeps itself out of a repository, and a draft is not a session.
  expect(fs.readFileSync(path.join(root, '.jamcli', '.gitignore'), 'utf8')).toContain('*');
  expect(readSessionIndex()).toEqual([]);
});

test('an empty draft, or clearing one, removes the file', () => {
  saveDraft(root, 's1', { text: 'x', chips: {} });
  saveDraft(root, 's1', { text: '', chips: {} });
  expect(fs.existsSync(draftFileFor(root, 's1'))).toBe(false);
  saveDraft(root, 's1', { text: 'y', chips: {} });
  clearDraft(root, 's1');
  expect(fs.existsSync(draftFileFor(root, 's1'))).toBe(false);
  // Clearing what is not there is fine.
  clearDraft(root, 's1');
});

test('a draft left by a session whose process has ended is taken by the next session, once', () => {
  leave('old', 'thirty minutes of typing', deadPid(), { '1': 'a paste' });
  const taken = adoptOrphanDraft(root, 'new');
  expect(taken).toEqual({ text: 'thirty minutes of typing', chips: { '1': 'a paste' }, from: 'old' });
  expect(fs.readdirSync(historyDirFor(root))).toEqual([]);
  // A second start finds nothing left to take.
  expect(adoptOrphanDraft(root, 'newer')).toBeUndefined();
});

test('the newest of several orphaned drafts is taken first, and the others wait for a later start', () => {
  leave('older', 'older text', deadPid());
  leave('newer', 'newer text', deadPid());
  fs.utimesSync(draftFileFor(root, 'older'), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  expect(adoptOrphanDraft(root, 'new')?.text).toBe('newer text');
  expect(fs.readdirSync(historyDirFor(root))).toEqual(['older.draft']);
  expect(adoptOrphanDraft(root, 'later')?.text).toBe('older text');
});

test('a draft of a session still running is left alone, and so is this session\'s own', () => {
  leave('running', 'someone is typing this', process.pid);
  leave('mine', 'my own draft', deadPid());
  expect(adoptOrphanDraft(root, 'mine')).toBeUndefined();
  expect(adoptOrphanDraft(root, 'other')?.text).toBe('my own draft');
  expect(fs.existsSync(draftFileFor(root, 'running'))).toBe(true);
});

test('a file that is not a draft is ignored and kept', () => {
  fs.mkdirSync(historyDirFor(root), { recursive: true });
  fs.writeFileSync(draftFileFor(root, 'broken'), '{ not json');
  fs.writeFileSync(draftFileFor(root, 'odd'), JSON.stringify({ pid: 'x', text: 3 }));
  expect(adoptOrphanDraft(root, 'new')).toBeUndefined();
  expect(fs.readdirSync(historyDirFor(root)).sort()).toEqual(['broken.draft', 'odd.draft']);
});

test('a project with no history yet has no draft to take', () => {
  expect(adoptOrphanDraft(root, 'new')).toBeUndefined();
});
