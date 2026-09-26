import { expect, test } from 'bun:test';
import type { ChatMessage } from '../../types.js';
import type { TranscriptEvent } from '../../transcript/events.js';
import { signalsOf } from '../signals.js';

const header: TranscriptEvent = { v: 2, type: 'session', ts: 0, id: 's', projectRoot: '/p', cwd: '/p', surface: 'test', jamcli: '0' };
const message = (m: Partial<ChatMessage> & Pick<ChatMessage, 'role'>): TranscriptEvent => ({
  v: 2,
  type: 'message',
  ts: 0,
  message: { content: '', timestamp: 0, ...m },
});
const call = (name: string, args: object) => message({ role: 'assistant', tool_calls: [{ id: name, function: { name, arguments: JSON.stringify(args) } }] });
const result = (toolName: string, toolStatus: ChatMessage['toolStatus'], content = '') => message({ role: 'tool', toolName, toolStatus, content });
const usage = (total: number): TranscriptEvent => ({ v: 2, type: 'usage', ts: 0, usage: { prompt_tokens: total, completion_tokens: 0, total_tokens: total } });

test('a clean session has no signals', () => {
  const events = [header, message({ role: 'user', content: 'hi' }), call('read_file', { path: 'a.ts' }), result('read_file', 'ok'), message({ role: 'assistant', content: 'a.ts looks fine' })];
  expect(signalsOf(events)).toEqual([]);
});

test('each failure is found at the index of its event', () => {
  const events: TranscriptEvent[] = [
    header,
    message({ role: 'user', content: 'fix it' }),
    call('edit_file', { path: 'a.ts' }),
    result('edit_file', 'error', 'no match for old text'),
    call('edit_file', { path: 'a.ts' }),
    { v: 2, type: 'approval', ts: 0, callId: 'c', tool: 'run_command', allow: false, scope: 'once', by: 'user', surface: 'tui', feedback: 'use bun, not npm' },
    { v: 2, type: 'end', ts: 0, status: 'cancelled' },
    message({ role: 'user', content: 'no, the other file' }),
  ];
  const found = signalsOf(events).map((s) => [s.id, s.kind]);
  expect(found).toEqual([
    [3, 'tool_error'],
    [4, 'retry'],
    [5, 'denied'],
    [6, 'cancelled'],
    [7, 'correction'],
  ]);
  expect(signalsOf(events).find((s) => s.kind === 'denied')?.detail).toContain('use bun, not npm');
  expect(signalsOf(events).find((s) => s.kind === 'correction')?.confidence).toBe('low');
});

test('a user message with no failure before it is not a correction', () => {
  const events = [header, message({ role: 'user', content: 'no wait, also do b' })];
  expect(signalsOf(events)).toEqual([]);
});

test('a token spike and an unused read are waste', () => {
  const events = [header, usage(100), usage(120), usage(110), usage(900), call('read_file', { path: 'unused.ts' }), result('read_file', 'ok'), message({ role: 'assistant', content: 'done' })];
  const waste = signalsOf(events).filter((s) => s.kind === 'waste');
  expect(waste.map((s) => s.id)).toEqual([4, 5]);
});

test('too few requests judge no spike', () => {
  expect(signalsOf([header, usage(10), usage(1000)])).toEqual([]);
});
