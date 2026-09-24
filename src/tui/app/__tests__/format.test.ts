import { expect, test } from 'bun:test';
import { diffStat, statusParts, toolLine } from '../format.js';
import { initialView } from '../../state/view.js';

const diff = 'Index: a.txt\n===\n--- a.txt\n+++ a.txt\n@@ -1,3 +1,4 @@\n one\n-two\n+TWO\n+2b\n three\n';

test('a diff is counted by the lines it adds and removes, not its headers', () => {
  expect(diffStat(diff)).toEqual({ added: 2, removed: 1 });
  expect(diffStat('')).toEqual({ added: 0, removed: 0 });
});

test('a tool line says its state in a word, with the change, the time, and who decided', () => {
  const row = { kind: 'tool' as const, id: 1, callId: 'e', tool: 'edit', summary: 'edit a.txt', phase: 'ok' as const, output: '', collapsed: false, diff, durationMs: 1500 };
  expect(toolLine(row)).toBe('✓ done: edit a.txt, 2 lines added and 1 removed, 1.5 s');
  expect(toolLine({ ...row, diff: undefined, phase: 'denied', durationMs: 3, decision: { allow: false, by: 'user', scope: 'once' } }, false)).toBe('denied: edit a.txt, 3 ms (denied by you)');
  expect(toolLine({ ...row, diff: undefined, phase: 'timeout', durationMs: undefined, decision: { allow: true, by: 'policy', scope: 'once' } })).toBe('⏱ timed out: edit a.txt');
});

test('the status line names each fact in words, and marks a cost that misses unpriced requests', () => {
  const status = { ...initialView().status, mode: 'plan', model: 'anthropic:claude-x', sandbox: 'bwrap', contextPercent: 41.6, costUsd: 0.0123, unpriced: 1, inputTokens: 12_345, outputTokens: 678, mcpServers: 2, phase: 'waiting' as const };
  expect(statusParts(status)).toEqual(['plan mode', 'anthropic:claude-x', 'context 42%', '$0.0123+', '12k in, 678 out', 'sandbox bwrap', 'MCP 2', 'waiting for you']);
  expect(statusParts({ ...status, costUsd: null, contextPercent: undefined, mcpServers: 0, sandbox: 'none', phase: 'retrying', retry: { attempt: 2, delayMs: 10, reason: '429' } })).toEqual([
    'plan mode',
    'anthropic:claude-x',
    'cost unknown',
    '12k in, 678 out',
    'no sandbox',
    'retrying (2): 429',
  ]);
});
