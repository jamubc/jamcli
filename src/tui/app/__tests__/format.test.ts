import { expect, test } from 'bun:test';
import { diffRows, diffStat, statusParts, thinkingLine, thinkingSize, thinkingWindow, toolLine } from '../format.js';
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
  // The language servers that can run here are counted beside MCP, and zero takes no room.
  expect(statusParts({ ...status, lspServers: 3 })).toContain('LSP 3');
  expect(statusParts({ ...status, lspServers: 0 })).not.toContain('LSP 0');
  expect(statusParts({ ...status, costUsd: null, contextPercent: undefined, mcpServers: 0, sandbox: 'none', phase: 'retrying', retry: { attempt: 2, delayMs: 10, reason: '429' } })).toEqual([
    'plan mode',
    'anthropic:claude-x',
    'cost unknown',
    '12k in, 678 out',
    'no sandbox',
    'retrying (2): 429',
  ]);
  // A free model's nothing takes no room; nothing plus requests with no price still shows.
  expect(statusParts({ ...status, costUsd: 0, unpriced: 0 })).not.toContain('$0.00');
  expect(statusParts({ ...status, costUsd: 0, unpriced: 2 })).toContain('$0.00+');
});

test('the thinking window keeps its height and its width, however much has arrived', () => {
  const size = thinkingSize({ lines: 3, width: 20 }, 200);
  const height = (text: string) => thinkingWindow(text, size).split('\n');
  // Nothing yet, one word, and far more than fits all draw the same three lines of the same width.
  for (const reasoning of ['', 'I', 'I should read the file before I change it, and then run the tests again.']) {
    const lines = height(reasoning);
    expect(lines).toHaveLength(3);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(20);
  }
  // It is the end of the thinking that shows, so the newest words are on screen.
  expect(height('one\ntwo\nthree\nfour').join('|')).toBe('two|three|four');
  // A word wider than the window is cut rather than pushing the window wider.
  expect(height('x'.repeat(45)).every((line) => line.length <= 20)).toBe(true);
});

test('the thinking window is never wider than the terminal, and never shorter than a line', () => {
  expect(thinkingSize({ lines: 5, width: 100 }, 40)).toEqual({ lines: 5, width: 40 });
  expect(thinkingSize({ lines: 0, width: 5 }, 200)).toEqual({ lines: 1, width: 20 });
  expect(thinkingSize(undefined, 200)).toEqual({ lines: 3, width: 72 });
});

test('thinking that is done shows as one line saying how much of it there is', () => {
  const reasoning = 'first\n\nsecond\nthird';
  expect(thinkingLine(reasoning, false)).toBe('▸ thinking, 3 lines');
  expect(thinkingLine(reasoning, true)).toBe('▾ thinking, 3 lines');
  expect(thinkingLine('only this', false, false)).toBe('thinking, 1 line');
});

test('a diff is drawn in the lines of its hunks, not its headers', () => {
  expect(diffRows(diff)).toBe(5);
  const twoHunks = `${diff}@@ -20,2 +21,2 @@\n-twenty\n+TWENTY\n`;
  expect(diffRows(twoHunks)).toBe(7);
  expect(diffRows('')).toBe(0);
});
