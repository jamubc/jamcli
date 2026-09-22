import { test, expect } from 'bun:test';
import { adaptLegacyProvider } from '../legacy.js';

test('the legacy adapter normalizes flat tool calls to the wire shape', async () => {
  const seen: any[] = [];
  const adapter = adaptLegacyProvider({
    async *streamChat() {},
    async complete(_messages: any[], options: any) {
      seen.push(options);
      return {
        content: '',
        toolCalls: [{ id: 'a', name: 'list_files', arguments: { pattern: 'x' } }],
      };
    },
  });
  const result = await adapter.complete(
    [{ role: 'user', content: 'hi', timestamp: 0 }],
    { model: 'm', tools: [{ type: 'function', function: { name: 'list_files' } }] }
  );
  expect(result.toolCalls).toEqual([
    { id: 'a', type: 'function', function: { name: 'list_files', arguments: { pattern: 'x' } } },
  ]);
  expect(seen[0].toolChoice).toBe('auto');
});

test('the legacy adapter passes wire-shaped tool calls through', async () => {
  const wire = [{ id: 'b', type: 'function', function: { name: 'grep', arguments: {} } }];
  const adapter = adaptLegacyProvider({
    async *streamChat() {},
    async complete() {
      return { content: 'done', toolCalls: wire };
    },
  });
  const result = await adapter.complete([{ role: 'user', content: 'hi', timestamp: 0 }], {});
  expect(result.toolCalls).toEqual(wire);
  expect(result.content).toBe('done');
});
