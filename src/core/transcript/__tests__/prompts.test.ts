import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SessionLog, TranscriptRecorder, parseTranscriptLine, projectMessages, sessionFileFor, transcriptToMarkdown, typedPrompts } from '../index.js';

let root: string;
let previousState: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-prompts-'));
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, 'state');
});

afterEach(() => {
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
});

const open = () => {
  const log = SessionLog.create(root, { surface: 'tui' });
  return { log, recorder: new TranscriptRecorder(log, { surface: 'tui', model: 'm' }) };
};

test('a prompt is kept as typed, sent or cleared, and a slash line alone is worth a file', () => {
  const { log, recorder } = open();
  recorder.recordPrompt('/help', 'sent');
  expect(fs.existsSync(sessionFileFor(root, log.id))).toBe(true);
  recorder.recordPrompt('line one\nline two', 'sent');
  recorder.recordPrompt('half a thought', 'cleared');
  expect(typedPrompts(log.events()).map(({ text, state }) => [text, state])).toEqual([
    ['/help', 'sent'],
    ['line one\nline two', 'sent'],
    ['half a thought', 'cleared'],
  ]);
});

test('the same prompt twice in a row is written once, and again after another', () => {
  const { log, recorder } = open();
  recorder.recordPrompt('go', 'sent');
  recorder.recordPrompt('go', 'sent');
  recorder.recordPrompt('stop', 'sent');
  recorder.recordPrompt('go', 'sent');
  expect(typedPrompts(log.events()).map((prompt) => prompt.text)).toEqual(['go', 'stop', 'go']);
  // A draft cleared after the same text was sent is a different fact.
  recorder.recordPrompt('go', 'cleared');
  expect(typedPrompts(log.events()).at(-1)).toMatchObject({ text: 'go', state: 'cleared' });
});

test('a prompt is never part of the conversation the model reads, and does not count as a message', () => {
  const { log, recorder } = open();
  recorder.recordPrompt('secret draft', 'cleared');
  recorder.handle({ type: 'message', message: { role: 'user', content: 'fix it', timestamp: 1 } });
  recorder.recordPrompt('fix it', 'sent');
  expect(JSON.stringify(projectMessages(log.events()))).not.toContain('secret draft');
  expect(projectMessages(log.events())).toHaveLength(1);
  const markdown = transcriptToMarkdown(log.events());
  expect(markdown).toContain('- Messages: 1');
  expect(markdown).toContain('- Typed prompts: 2, 1 cleared');
  expect(markdown).toContain('> **Cleared draft** (not sent to the model): secret draft');
});

test('prompts survive a compaction and a reopen, when the messages before it are gone', () => {
  const { log, recorder } = open();
  for (const text of ['first', 'second', 'third']) {
    recorder.recordPrompt(text, 'sent');
    recorder.handle({ type: 'message', message: { role: 'user', content: `expanded ${text}`, timestamp: 1 } });
    recorder.handle({ type: 'message', message: { role: 'assistant', content: `reply ${text}`, timestamp: 2 } });
  }
  log.append({ type: 'compaction', summary: 'first three', replaced: 6, before: 100, after: 10 });
  const reopened = SessionLog.open(root, log.id);
  expect(reopened.toSession().messages.map((message) => message.content).join(' ')).not.toContain('expanded first');
  expect(typedPrompts(reopened.events()).map((prompt) => prompt.text)).toEqual(['first', 'second', 'third']);
  // The recorder that resumes the session does not repeat the last one either.
  const resumed = new TranscriptRecorder(reopened, { surface: 'tui', model: 'm' });
  resumed.recordPrompt('third', 'sent');
  expect(typedPrompts(reopened.events())).toHaveLength(3);
});

test('a log written before prompts existed loads and projects as it did, with none listed', () => {
  const file = sessionFileFor(root, 'old');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ id: 't', timestamp: '2026-01-02T03:04:05.000Z', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] })}\n`);
  const log = SessionLog.open(root, 'old');
  expect(typedPrompts(log.events())).toEqual([]);
  expect(projectMessages(log.events()).map((message) => message.content)).toEqual(['hi', 'hello']);
});

test('a prompt line in a log file is read back as a typed prompt', () => {
  const [event] = parseTranscriptLine(JSON.stringify({ v: 2, type: 'prompt', ts: 1, text: 'hi', state: 'sent' }));
  expect(typedPrompts([event])).toEqual([{ text: 'hi', state: 'sent', ts: 1 }]);
});
