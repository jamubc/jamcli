import { test, expect } from 'bun:test';
import { ContextManager } from '../manager.js';
import type { ChatProvider } from '../providers/types.js';
import type { ChatMessage } from '../types.js';

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
