import { test, expect } from 'bun:test';
import { ContextManager } from '../manager.js';
import type { ChatProvider } from '../../providers/types.js';
import type { ChatMessage } from '../../types.js';

const quiet: ChatProvider = {
  async *streamChat() {},
  async complete() {
    return { content: 'summary' };
  },
};

const msg = (role: ChatMessage['role'], content: string): ChatMessage => ({
  role,
  content,
  timestamp: Date.now(),
});

test('/compact truncates deterministically and reports counts', async () => {
  const messages = [msg('system', 'base'), ...Array.from({ length: 30 }, (_, i) => msg('user', `message number ${i} with padding text to grow tokens`))];
  const result = await ContextManager.manageContext(
    messages,
    { enabled: true, max_tokens: 200, compression_threshold: 0.9, strategy: 'truncate' },
    quiet,
    'test-model',
    true
  );
  expect(result.context.length).toBeLessThan(messages.length);
  expect(result.context[0].role).toBe('system');
  expect(result.systemNotice).toContain('truncated');
});

test('forced summarize compresses older turns and keeps the tail verbatim', async () => {
  const messages = [
    msg('system', 'base'),
    ...Array.from({ length: 8 }, (_, i) => msg('user', `older turn ${i}`)),
    ...Array.from({ length: 4 }, (_, i) => msg('assistant', `recent reply ${i}`)),
  ];
  const result = await ContextManager.manageContext(
    messages,
    { enabled: true, max_tokens: 100000, compression_threshold: 0.9, strategy: 'summarize' },
    quiet,
    'test-model',
    true
  );
  expect(result.systemNotice).toContain('compressed');
  const tail = result.context.slice(-4).map((m) => m.content);
  expect(tail).toEqual(['recent reply 0', 'recent reply 1', 'recent reply 2', 'recent reply 3']);
  expect(result.context.some((m) => m.content.startsWith('[Context Summary]'))).toBe(true);
});

test('a failing summarizer keeps the original context', async () => {
  const failing: ChatProvider = {
    async *streamChat() {},
    async complete() {
      throw new Error('provider down');
    },
  };
  const messages = [msg('system', 'base'), ...Array.from({ length: 8 }, (_, i) => msg('user', `older turn ${i}`))];
  const result = await ContextManager.manageContext(
    messages,
    { enabled: true, max_tokens: 100000, compression_threshold: 0.9, strategy: 'summarize' },
    failing,
    'test-model',
    true
  );
  expect(result.context).toEqual(messages);
  expect(result.systemNotice).toContain('Failed');
});

const call = (...ids: string[]): ChatMessage => ({
  role: 'assistant',
  content: '',
  timestamp: 0,
  tool_calls: ids.map((id) => ({ id, type: 'function', function: { name: 'read_file', arguments: {} } })),
});
const toolResult = (id: string, content = 'result'): ChatMessage => ({ role: 'tool', content, tool_call_id: id, timestamp: 0 });
const orphaned = (messages: ChatMessage[]) => {
  const ids = new Set(messages.flatMap((message) => (message.tool_calls ?? []).map((toolCall) => toolCall.id)));
  return messages.filter((message) => message.role === 'tool' && !ids.has(message.tool_call_id));
};

test('the legacy summarizer keeps a tool call with its results', async () => {
  // Keeping the last four messages would start the tail on a result whose call was summarized.
  const messages = [msg('system', 'base'), msg('user', 'read three files'), call('c1', 'c2', 'c3'), toolResult('c1'), toolResult('c2'), toolResult('c3'), msg('assistant', 'done')];
  const result = await ContextManager.manageContext(messages, { enabled: true, max_tokens: 100000, compression_threshold: 0.9, strategy: 'summarize' }, quiet, 'test-model', true);
  expect(orphaned(result.context)).toEqual([]);
  expect(result.context.at(-1)!.content).toBe('done');
});

test('legacy truncation drops a result whose call did not fit', async () => {
  // The call's own text is what does not fit, so the cut falls between it and its result.
  const messages = [msg('system', 'base'), msg('user', 'read it'), { ...call('c1'), content: 'y'.repeat(100) }, toolResult('c1', 'x'.repeat(200)), msg('assistant', 'done')];
  const result = await ContextManager.manageContext(messages, { enabled: true, max_tokens: 60, compression_threshold: 0.9, strategy: 'truncate' }, quiet, 'test-model', true);
  expect(orphaned(result.context)).toEqual([]);
  expect(result.context.map((message) => message.role)).toEqual(['system', 'assistant']);
});
