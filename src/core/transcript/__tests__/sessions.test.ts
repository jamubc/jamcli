import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SessionLog, listSessionSummaries, readSessionIndex, sessionFileFor, transcriptToMarkdown, type NewTranscriptEvent } from '../index.js';
import { exportSession, forkSession, latestSessionId, loadSessionMessages, searchSessions } from '../../session/store.js';
import { HistoryService } from '../../../services/HistoryService.js';

let root: string;
let other: string;
let previousState: string | undefined;

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-sessions-'));
  root = path.join(base, 'project');
  other = path.join(base, 'elsewhere');
  fs.mkdirSync(root);
  fs.mkdirSync(other);
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(base, 'state');
});

afterEach(() => {
  const base = path.dirname(root);
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(base, { recursive: true, force: true });
});

const say = (log: SessionLog, role: 'user' | 'assistant', content: string) =>
  log.append({ type: 'message', message: { role, content, timestamp: Date.now() } });

const record = (projectRoot: string, ...contents: string[]): SessionLog => {
  const log = SessionLog.create(projectRoot, { surface: 'cli' });
  contents.forEach((content, index) => say(log, index % 2 ? 'assistant' : 'user', content));
  log.updateIndex();
  return log;
};

test('the index takes the creation time from the file, keeps the title, and counts messages', async () => {
  const log = record(root, 'Please rename the parser module', 'Done.');
  const [first] = readSessionIndex();
  expect(first).toMatchObject({ id: log.id, projectRoot: root, messageCount: 2, title: 'Rename the parser module' });
  expect(first.created).toBe(new Date(log.events()[0].ts).toISOString());
  await Bun.sleep(5);
  say(log, 'user', 'and the tests');
  log.append({ type: 'usage', usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } });
  // A delegated session's tokens belong to that session's own entry.
  log.append({ type: 'usage', usage: { prompt_tokens: 50, completion_tokens: 50, total_tokens: 100 }, delegated: 'child-session' });
  log.updateIndex();
  const entries = readSessionIndex();
  expect(entries).toHaveLength(1);
  expect(entries[0].created).toBe(first.created);
  expect(entries[0].updated > first.updated).toBe(true);
  expect(entries[0]).toMatchObject({ messageCount: 3, totalTokens: 7 });
  expect(transcriptToMarkdown(log.events())).toContain('- Tokens: 7');
});

test('a version 1 session is dated by its first turn, not by the last update', () => {
  const file = sessionFileFor(root, 'v1');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const turn = { timestamp: '2025-05-05T05:05:05.000Z', messages: [{ role: 'user', content: 'old' }] };
  fs.writeFileSync(file, `${JSON.stringify(turn)}\n`);
  // Version 1 wrote the time of the last update as the creation time.
  const stale = { id: 'v1', projectRoot: root, projectName: 'project', created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z', totalTokens: 0, messageCount: 0 };
  fs.mkdirSync(process.env.JAMCLI_STATE_DIR!, { recursive: true });
  fs.writeFileSync(path.join(process.env.JAMCLI_STATE_DIR!, 'sessions.jsonl'), `${JSON.stringify(stale)}\n`);
  SessionLog.open(root, 'v1').updateIndex();
  expect(readSessionIndex()).toHaveLength(1);
  expect(readSessionIndex()[0]).toMatchObject({ created: '2025-05-05T05:05:05.000Z', messageCount: 1 });
});

test('a session recorded for another project is not listed here, even under the same id', () => {
  const log = record(other, 'copied project');
  fs.mkdirSync(path.dirname(sessionFileFor(root, log.id)), { recursive: true });
  fs.copyFileSync(log.file, sessionFileFor(root, log.id));
  expect(listSessionSummaries(root)).toEqual([]);
  expect(listSessionSummaries(other).map((entry) => entry.id)).toEqual([log.id]);
});

test('listing and --continue see only this project, newest first', async () => {
  const older = record(root, 'older');
  await Bun.sleep(5);
  const newer = record(root, 'newer');
  await Bun.sleep(5);
  record(other, 'another project, most recent of all');
  expect(listSessionSummaries(root).map((entry) => entry.id)).toEqual([newer.id, older.id]);
  expect(await latestSessionId(root)).toBe(newer.id);
  fs.rmSync(newer.file);
  expect(await latestSessionId(root)).toBe(older.id);
});

test('search matches message content, not only titles', async () => {
  const log = record(root, 'fix the build', 'The flag --frobnicate was missing.');
  record(root, 'unrelated');
  record(other, 'frobnicate elsewhere');
  expect((await searchSessions(root, 'FROBNICATE')).map((entry) => entry.id)).toEqual([log.id]);
});

test('the store loads, forks, and exports with tool calls intact', async () => {
  const log = SessionLog.create(root, { surface: 'cli' });
  say(log, 'user', 'list files');
  log.append({
    type: 'message',
    message: {
      role: 'assistant',
      content: '',
      timestamp: 1,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'glob', arguments: '{"pattern":"*.ts"}' } }],
    },
  });
  log.append({ type: 'message', message: { role: 'tool', content: 'a.ts', tool_call_id: 'c1', toolName: 'glob', toolStatus: 'ok', timestamp: 2 } });
  log.updateIndex();

  const messages = await loadSessionMessages(root, log.id);
  expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  expect(messages[1].tool_calls?.[0].function.name).toBe('glob');

  const forked = await forkSession(root, log.id, { surface: 'cli' });
  expect(forked).not.toBeNull();
  expect((await loadSessionMessages(root, forked!)).map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  expect(await forkSession(root, 'missing')).toBeNull();

  const file = await exportSession(root, log.id);
  expect(file).toBe(path.join(root, '.jamcli', 'history', `${log.id}.md`));
  const markdown = fs.readFileSync(file, 'utf8');
  expect(markdown).toContain('**Tool call** `glob` `c1`');
  expect(markdown).toContain('"pattern": "*.ts"');
  expect(markdown).toContain('### Result: `glob` `c1` (ok)');
});

test('Markdown shows decisions and notices, and fences survive backticks in output', () => {
  const events: NewTranscriptEvent[] = [
    { type: 'message', message: { role: 'user', content: 'run it', timestamp: 1 } },
    { type: 'approval', callId: 'c2', tool: 'run_command', allow: true, scope: 'session', by: 'user', surface: 'tui', rule: 'run_command(npm test)' },
    { type: 'approval', callId: 'c3', tool: 'write_file', allow: false, scope: 'once', by: 'user', surface: 'tui', feedback: 'use edit' },
    { type: 'message', message: { role: 'tool', content: 'has ```` fences', tool_call_id: 'c2', timestamp: 2 } },
    { type: 'notice', level: 'warn', message: 'Removed grep result', code: 'trust' },
    { type: 'end', status: 'refused' },
  ];
  const markdown = transcriptToMarkdown(events.map((event) => ({ v: 2, ts: 0, ...event }) as any), { id: 's1' });
  expect(markdown).toContain('`run_command` `c2` allowed for this session by user on tui, rule `run_command(npm test)`');
  expect(markdown).toContain('`write_file` `c3` denied by user on tui\n> Feedback: use edit');
  expect(markdown).toContain('> **Notice** (warn, trust): Removed grep result');
  expect(markdown).toContain('`````text\nhas ```` fences\n`````');
  expect(markdown).toContain('*Turn ended: refused*');
});

test('HistoryService reads a version 1 file and writes version 2 turns to it', async () => {
  const file = sessionFileFor(root, 'v1');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const legacy = JSON.stringify({ id: 't', timestamp: '2026-01-01T00:00:00.000Z', messages: [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'reply' }] });
  fs.writeFileSync(file, `${legacy}\n`);

  const history = new HistoryService(root, 'v1');
  await history.initialize();
  expect((await history.loadMessagesFromHistory()).map((m) => m.content)).toEqual(['old', 'reply']);
  await history.appendTurn(
    [
      { role: 'user', content: 'new', timestamp: 1 },
      { role: 'assistant', content: 'answer', timestamp: 2, model: 'm', streaming: false },
    ],
    { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  );
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  expect(lines[0]).toBe(legacy);
  expect(lines.slice(1).map((line) => JSON.parse(line).v)).toEqual([2, 2, 2]);
  expect(lines.join('\n')).not.toContain('streaming');
  expect((await history.loadMessagesFromHistory()).map((m) => m.content)).toEqual(['old', 'reply', 'new', 'answer']);
  expect((await history.listSessions()).map((entry) => entry.id)).toEqual(['v1']);
  expect(await history.exportToMarkdown()).toContain('## Assistant (m)\n\nanswer');
});

test('HistoryService never starts a window of messages on an orphaned tool result', async () => {
  const log = SessionLog.create(root, { surface: 'tui' });
  say(log, 'user', 'q');
  log.append({
    type: 'message',
    message: { role: 'assistant', content: '', timestamp: 1, tool_calls: [{ id: 'c', type: 'function', function: { name: 'glob', arguments: '{}' } }] },
  });
  log.append({ type: 'message', message: { role: 'tool', content: 'r', tool_call_id: 'c', timestamp: 2 } });
  say(log, 'assistant', 'done');
  const window = await new HistoryService(root, log.id).loadMessagesFromHistory(2);
  expect(window.map((m) => m.role)).toEqual(['assistant']);
});

const cli = (...args: string[]) => {
  const result = Bun.spawnSync(['bun', path.join(import.meta.dir, '../../../index.tsx'), ...args, '--cwd', root], {
    env: { ...process.env },
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
};

test('jamcli sessions show, fork, and export work from the command line', () => {
  const log = record(root, 'describe the plan', 'Here it is.');
  const shown = cli('sessions', 'show', log.id);
  expect(shown.code).toBe(0);
  expect(shown.out).toContain('## User\n\ndescribe the plan');

  const forked = cli('sessions', 'fork', log.id);
  expect(forked.code).toBe(0);
  const id = forked.out.trim();
  expect(SessionLog.open(root, id).events()[0]).toMatchObject({ surface: 'cli', parent: { session: log.id } });

  expect(cli('sessions', 'export', log.id).out).toContain('2 messages exported to');
  const missing = cli('sessions', 'show', 'missing');
  expect(missing.code).toBe(1);
  expect(missing.err).toContain('No session named missing');
});

test('an export says what the session cost, whose requests they were, and which had no price', () => {
  const log = record(root, 'Price this', 'Priced.');
  const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
  log.append({ type: 'usage', model: 'anthropic:claude-x', usage, cost: 0.002 });
  log.append({ type: 'usage', model: 'anthropic:claude-y', usage, cost: 0.001, delegated: 'child-1' });
  log.append({ type: 'usage', model: 'openai:mystery', usage });
  const markdown = transcriptToMarkdown(log.events());
  expect(markdown).toContain('- Cost: $0.0030 over 3 requests, $0.0010 of it by delegated tasks, and 1 unpriced request');
  expect(markdown).toContain('*Usage (anthropic:claude-x): 100 prompt and 10 completion tokens, $0.0020*');
  expect(markdown).toContain('*Usage (anthropic:claude-y, delegated session `child-1`): 100 prompt and 10 completion tokens, $0.0010*');
  expect(markdown).toContain('*Usage (openai:mystery): 100 prompt and 10 completion tokens, unpriced*');
  // A session that made no request has no cost line.
  expect(transcriptToMarkdown(record(root, 'Nothing yet').events())).not.toContain('- Cost:');
});
