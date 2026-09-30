import { expect, test } from 'bun:test';
import { closeMarkers, diffRows, diffStat, fitStatus, keepCitations, statusParts, thinkingLine, thinkingSize, toolLine, wrapWithin } from '../format.js';
import { initialView } from '../../state/view.js';

const diff = 'Index: a.txt\n===\n--- a.txt\n+++ a.txt\n@@ -1,3 +1,4 @@\n one\n-two\n+TWO\n+2b\n three\n';

test('a diff is counted by the lines it adds and removes, not its headers', () => {
  expect(diffStat(diff)).toEqual({ added: 2, removed: 1 });
  expect(diffStat('')).toEqual({ added: 0, removed: 0 });
});

test('a tool line leads with the call, then the change, the time, and who decided', () => {
  const row = { kind: 'tool' as const, id: 1, callId: 'e', tool: 'edit', summary: 'edit a.txt', phase: 'ok' as const, output: '', collapsed: false, diff, durationMs: 1500 };
  expect(toolLine(row)).toBe('✓ edit a.txt · +2 −1 · 1.5 s');
  // With no marks to carry it, the state is a word, after the facts rather than in front of the call.
  expect(toolLine({ ...row, diff: undefined, phase: 'denied', durationMs: 3, decision: { allow: false, by: 'user', scope: 'once' } }, false)).toBe('edit a.txt, 3 ms, denied, denied by you');
  // A grant names its rule where it was given, so what the session now allows is read there.
  expect(toolLine({ ...row, diff: undefined, phase: 'ok', durationMs: 3, decision: { allow: true, by: 'user', scope: 'session', rule: 'edit(src/**)' } })).toBe('✓ edit a.txt · 3 ms · allowed by you · edit(src/**)');
  expect(toolLine({ ...row, diff: undefined, phase: 'ok', durationMs: 3, decision: { allow: true, by: 'user', scope: 'session', rule: 'edit(src/**)' } }, false)).toBe('edit a.txt, 3 ms, done, allowed by you with edit(src/**)');
  // A call the policy decided says nothing about who: only the person's own decision is named.
  expect(toolLine({ ...row, diff: undefined, phase: 'timeout', durationMs: undefined, decision: { allow: true, by: 'policy', scope: 'once' } })).toBe('⏱ edit a.txt');
  expect(toolLine({ ...row, diff: undefined, phase: 'running', durationMs: undefined })).toBe('● edit a.txt');
});

test('the status line names each fact in words, and marks a cost that misses unpriced requests', () => {
  const status = { ...initialView().status, mode: 'plan', model: 'anthropic:claude-x', sandbox: 'bwrap', contextPercent: 41.6, costUsd: 0.0123, unpriced: 1, inputTokens: 12_345, outputTokens: 678, mcpServers: 2, phase: 'waiting' as const };
  expect(statusParts(status)).toEqual(['plan mode', 'anthropic:claude-x', 'context 42%', '$0.0123+', '12k in, 678 out', 'sandbox bwrap', 'MCP 2', 'waiting']);
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
  // What runs beside the turn is counted before the phase, and nothing running takes no room.
  expect(statusParts({ ...status, work: { jobs: 1, agents: 2 } }).slice(-2)).toEqual(['1 job, 2 agents', 'waiting']);
  expect(statusParts({ ...status, work: { jobs: 0, agents: 0 } })).not.toContain('0 jobs');
  // It is kept when the line does not fit, ahead of the counts that only inform.
  expect(fitStatus({ ...status, work: { jobs: 1, agents: 0 } }, 60, { separator: ' · ' })).toContain('1 job');
});

test('a reply mid-stream has its open markers closed, so words are styled from their first character', () => {
  expect(closeMarkers('Here is **bo')).toBe('Here is **bo**');
  expect(closeMarkers('x **bold** and *it')).toBe('x **bold** and *it*');
  expect(closeMarkers('a `co')).toBe('a `co`');
  expect(closeMarkers('a **b `c')).toBe('a **b `c`**');
  expect(closeMarkers('Here is ~~str')).toBe('Here is ~~str~~');
  expect(closeMarkers('__ini')).toBe('__ini__');
  // A closer has to follow a word, so a trailing space waits for the next chunk.
  expect(closeMarkers('**bold ')).toBe('**bold**');
  // A marker with nothing after it yet is left out: `****` would not be bold.
  expect(closeMarkers('Here is **')).toBe('Here is ');
  expect(closeMarkers('a `')).toBe('a ');
  // What is already balanced, or was never a marker, is left as written.
  expect(closeMarkers('done **bold** here')).toBe('done **bold** here');
  expect(closeMarkers('2 * 3 and 4 *')).toBe('2 * 3 and 4 *');
  expect(closeMarkers('snake_case and more_')).toBe('snake_case and more_');
  expect(closeMarkers('a \\*b')).toBe('a \\*b');
  // Only the last block can be unfinished, and code is never markup.
  expect(closeMarkers('para one\n\n**bo')).toBe('para one\n\n**bo**');
  expect(closeMarkers('```\nconst x = **not')).toBe('```\nconst x = **not');
  expect(closeMarkers('```\ncode\n```\n**bo')).toBe('```\ncode\n```\n**bo**');
});

test('the thinking window is never wider than the terminal, and never shorter than a line', () => {
  expect(thinkingSize({ lines: 5, width: 100 }, 40)).toEqual({ lines: 5, width: 40 });
  expect(thinkingSize({ lines: 0, width: 5 }, 200)).toEqual({ lines: 1, width: 20 });
  expect(thinkingSize(undefined, 200)).toEqual({ lines: 3, width: 72 });
});

test('thinking that is done shows as one line saying how much of it there is, as drawn', () => {
  const reasoning = 'first\n\nsecond\nthird';
  expect(thinkingLine(reasoning, false)).toBe('▸ thinking, 3 lines');
  expect(thinkingLine(reasoning, true)).toBe('▾ thinking, 3 lines');
  expect(thinkingLine('only this', false, false)).toBe('thinking, 1 line');
  // One long line of thought is the lines it wraps to in the window, not one.
  expect(thinkingLine('I should read the file first, then run the tests.', false, true, 20)).toBe('▸ thinking, 3 lines');
});

test('a diff is drawn in the lines of its hunks, not its headers', () => {
  expect(diffRows(diff)).toBe(5);
  const twoHunks = `${diff}@@ -20,2 +21,2 @@\n-twenty\n+TWENTY\n`;
  expect(diffRows(twoHunks)).toBe(7);
  expect(diffRows('')).toBe(0);
});

test('a status line that does not fit gives up the least useful facts first, and never the mode or what JamCLI is doing', () => {
  const status = { ...initialView().status, mode: 'default', model: 'opencode-go:deepseek-v4.1-flash', sandbox: 'seatbelt', contextPercent: 1, costUsd: 0.0011, unpriced: 0, inputTokens: 15_000, outputTokens: 558, lspServers: 4, phase: 'waiting' as const };
  const whole = fitStatus(status, 500, { separator: ' · ' });
  expect(whole).toBe('default mode · opencode-go:deepseek-v4.1-flash · context 1% · $0.0011 · 15k in, 558 out · sandbox seatbelt · LSP 4 · waiting');
  // At 110 columns, as seen on a real run, the phase was cut off; now the LSP count and the tokens go instead.
  const fitted = fitStatus(status, 110, { separator: ' · ' });
  expect(fitted.length).toBeLessThanOrEqual(110);
  expect(fitted).toStartWith('default mode · ');
  expect(fitted).toEndWith('waiting');
  expect(fitted).not.toContain('LSP 4');
  expect(fitted).toContain('context 1%');
  // Narrower still, only the mode, a shortened model, and the phase are left.
  const narrow = fitStatus(status, 50, { separator: ' · ' });
  expect(narrow.length).toBeLessThanOrEqual(50);
  expect(narrow).toStartWith('default mode · opencode-go:');
  expect(narrow).toEndWith('… · waiting');
  // While the indicator shows the phase, the line leaves it out.
  expect(fitStatus({ ...status, phase: 'thinking' }, 500, { separator: ' · ', withoutPhase: true })).not.toContain('thinking');
});

test('bracketed numbers are set as code, so the markdown view does not take them for links', () => {
  expect(keepCitations('Layered [1] and [6][7], see [3, 4] or [5-7].')).toBe('Layered `[1]` and `[6][7]`, see `[3, 4]` or `[5-7]`.');
  expect(keepCitations('the value of arr[0] stays')).toBe('the value of arr`[0]` stays');
  // A real link, a task box, words in brackets, code spans, and fenced code are left as written.
  expect(keepCitations('a [2](https://x.dev) link')).toBe('a [2](https://x.dev) link');
  expect(keepCitations('- [ ] open\n- [x] done\nand [sic]')).toBe('- [ ] open\n- [x] done\nand [sic]');
  expect(keepCitations('already `[1]` code')).toBe('already `[1]` code');
  expect(keepCitations('```js\nconst a = b[1];\n```\nthen [2]')).toBe('```js\nconst a = b[1];\n```\nthen `[2]`');
  // A fence still open, as while a reply streams, leaves the rest alone.
  expect(keepCitations('```\nb[1]')).toBe('```\nb[1]');
});

test('text wraps at spaces into at most the lines given, the last one ending in an ellipsis when there is more', () => {
  expect(wrapWithin('one two three', 20, 4)).toEqual(['one two three']);
  expect(wrapWithin('one two three four five six', 10, 4)).toEqual(['one two', 'three four', 'five six']);
  expect(wrapWithin('one two three four five six', 10, 2)).toEqual(['one two', 'three fou…']);
  // A word wider than the room is cut, and the line before the cut is not lost.
  expect(wrapWithin('abcdefghijkl', 5, 4)).toEqual(['abcde', 'fghij', 'kl']);
  expect(wrapWithin('a\nb', 10, 4)).toEqual(['a', 'b']);
  expect(wrapWithin('', 10, 4)).toEqual(['']);
});
