import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SessionLog, TranscriptRecorder, typedPrompts } from '../../../core/transcript/index.js';
import { earlierMessages } from '../history.js';

let root: string;
let previousState: string | undefined;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-history-')));
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, 'state');
});

afterEach(() => {
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
});

const say = (recorder: TranscriptRecorder, text: string) => {
  recorder.recordPrompt(text, 'sent');
  recorder.handle({ type: 'message', message: { role: 'user', content: `expanded ${text}`, timestamp: 1 } });
  recorder.handle({ type: 'message', message: { role: 'assistant', content: 'ok', timestamp: 2 } });
};

test('search lists what was typed, newest first, from the record: a slash line, a cleared draft, and what a compaction dropped', () => {
  const log = SessionLog.create(root, { surface: 'tui' });
  const recorder = new TranscriptRecorder(log, { surface: 'tui', model: 'm' });
  say(recorder, 'first');
  say(recorder, 'second');
  log.append({ type: 'compaction', summary: 'two turns', replaced: 4, before: 100, after: 10 });
  recorder.recordPrompt('/help', 'sent');
  recorder.recordPrompt('unfinished\nthought', 'cleared');

  const items = earlierMessages(root, { id: log.id, prompts: typedPrompts(log.events()), messages: log.toSession().messages });
  expect(items.map((item) => item.value)).toEqual(['unfinished\nthought', '/help', 'second', 'first']);
  expect(items[0]).toMatchObject({ label: 'unfinished …', detail: 'this session, cleared' });
  expect(items[1].detail).toBe('this session');
  expect(items.map((item) => item.value).join(' ')).not.toContain('expanded');
});

test('search reads the other sessions of the project the same way, and falls back to messages for one recorded before prompts', () => {
  const recorded = SessionLog.create(root, { surface: 'tui' });
  say(new TranscriptRecorder(recorded, { surface: 'tui', model: 'm' }), 'from a recorded session');
  recorded.updateIndex();

  const legacy = SessionLog.create(root, { surface: 'tui' });
  const older = new TranscriptRecorder(legacy, { surface: 'tui', model: 'm' });
  older.handle({ type: 'message', message: { role: 'user', content: 'from an old session', timestamp: 1 } });
  older.handle({ type: 'message', message: { role: 'assistant', content: 'ok', timestamp: 2 } });
  legacy.updateIndex();

  const current = SessionLog.create(root, { surface: 'tui' });
  const now = new TranscriptRecorder(current, { surface: 'tui', model: 'm' });
  say(now, 'now');

  const items = earlierMessages(root, { id: current.id, prompts: typedPrompts(current.events()), messages: current.toSession().messages });
  const values = items.map((item) => item.value);
  expect(values[0]).toBe('now');
  expect(values).toContain('from a recorded session');
  expect(values).toContain('from an old session');
  expect(values).not.toContain('expanded from a recorded session');
});
