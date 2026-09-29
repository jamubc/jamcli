import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SessionLog, readSessionIndex, readTranscript, recordSessionSummary, sessionFileFor, type TranscriptEvent } from '../index.js';

let base: string;
let root: string;
let previousState: string | undefined;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-scale-')));
  root = path.join(base, 'project');
  fs.mkdirSync(root);
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(base, 'state');
});
afterEach(() => {
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(base, { recursive: true, force: true });
});

const say = (log: SessionLog, content: string) => log.append({ type: 'message', message: { role: 'user', content, timestamp: 1 } });
const line = (content: string) => `${JSON.stringify({ v: 2, ts: 2, type: 'message', message: { role: 'user', content, timestamp: 2 } })}\n`;
const contents = (events: TranscriptEvent[]) => events.flatMap((event) => (event.type === 'message' ? [event.message.content] : []));

test("a session log parses only what was appended since its last read, and sees another writer's lines", () => {
  const log = SessionLog.create(root, { surface: 'headless' });
  say(log, 'one');
  say(log, 'two');
  const file = sessionFileFor(root, log.id);
  expect(log.events()).toEqual(readTranscript(file));

  // Garble the first line in place, keeping the file's size: a log that parsed everything
  // again would lose its header; one that reads only what was appended keeps it.
  const text = fs.readFileSync(file, 'utf8');
  const first = text.indexOf('\n');
  const fd = fs.openSync(file, 'r+');
  fs.writeSync(fd, 'x'.repeat(first), 0);
  fs.closeSync(fd);
  expect(readTranscript(file).some((event) => event.type === 'session')).toBe(false);
  expect(log.events().some((event) => event.type === 'session')).toBe(true);

  // A line another writer appends is read; a line not yet finished waits for its end.
  fs.appendFileSync(file, line('three'));
  fs.appendFileSync(file, line('four').slice(0, 20));
  expect(contents(log.events())).toEqual(['one', 'two', 'three']);
  fs.appendFileSync(file, line('four').slice(20));
  expect(contents(log.events())).toEqual(['one', 'two', 'three', 'four']);

  // A file replaced by a shorter one is read again whole.
  fs.writeFileSync(file, line('fresh'));
  expect(contents(log.events())).toEqual(['fresh']);
  fs.rmSync(file);
  expect(log.events()).toEqual([]);
});

test("the index is appended to, keeps each session's last summary, and is rewritten once stale lines outnumber sessions", () => {
  const index = path.join(base, 'state', 'sessions.jsonl');
  const events = (content: string): TranscriptEvent[] => [{ v: 2, ts: 1, type: 'message', message: { role: 'user', content, timestamp: 1 } }];
  recordSessionSummary(root, 'a', events('first request of a'));
  recordSessionSummary(root, 'b', events('first request of b'));
  recordSessionSummary(root, 'a', events('first request of a'));
  expect(fs.readFileSync(index, 'utf8').trim().split('\n')).toHaveLength(3);
  expect(readSessionIndex().map((entry) => entry.id).sort()).toEqual(['a', 'b']);

  // The same session recorded through a symlink to its project is still one entry.
  const link = path.join(base, 'link');
  fs.symlinkSync(root, link);
  recordSessionSummary(link, 'a', events('first request of a'));
  expect(readSessionIndex().map((entry) => entry.id).sort()).toEqual(['a', 'b']);

  // A line a newer JamCLI wrote is skipped rather than misread.
  fs.appendFileSync(index, `${JSON.stringify({ v: 2, id: 'c', projectRoot: root, shape: 'new' })}\n`);
  expect(readSessionIndex().map((entry) => entry.id).sort()).toEqual(['a', 'b']);

  for (let update = 0; update < 110; update += 1) recordSessionSummary(root, update % 2 ? 'a' : 'b', events('again'));
  const lines = fs.readFileSync(index, 'utf8').trim().split('\n');
  expect(lines.length).toBeLessThan(110);
  expect(readSessionIndex().map((entry) => entry.id).sort()).toEqual(['a', 'b']);
  expect(lines.every((entry) => JSON.parse(entry).v === 1)).toBe(true);
});
