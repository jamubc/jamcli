import { expect, test } from 'bun:test';
import { elide } from '../elide.js';
import type { ChatMessage } from '../../types.js';

const user = (content: string): ChatMessage => ({ role: 'user', content, timestamp: 0 });
const call = (id: string, name: string, args: Record<string, unknown>, text = ''): ChatMessage => ({
  role: 'assistant',
  content: text,
  timestamp: 0,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
const result = (id: string, name: string, content: string): ChatMessage => ({ role: 'tool', content, tool_call_id: id, toolName: name, timestamp: 0 });
const say = (text: string): ChatMessage => ({ role: 'assistant', content: text, timestamp: 0 });
/** `n` assistant steps that say nothing, to age what came before. */
const steps = (n: number) => Array.from({ length: n }, (_, i) => say(`step ${i}`));

const fileText = '1|aaaaaaaaaaaa|const a = 1;\n2|bbbbbbbbbbbb|const b = 2;\n[Showing lines 1-2 of 40. Continue with offset 3.]';

test('E1: a read superseded by a later write becomes a stub, unless the model quoted its path later', () => {
  const messages = [user('go'), call('r1', 'read_file', { path: 'src/a.ts' }), result('r1', 'read_file', fileText), call('e1', 'edit', { path: 'src/a.ts', find_string: 'a', replace_string: 'b' }), result('e1', 'edit', 'Replaced 1 occurrence.'), say('done')];
  const { messages: out, elisions } = elide(messages, 5);
  expect(elisions).toEqual([{ stage: 'E1', message: 2, tokensRemoved: expect.any(Number), stub: '[read src/a.ts lines 1-2; superseded by edit at step 2]' }]);
  expect(out[2].content).toBe('[read src/a.ts lines 1-2; superseded by edit at step 2]');
  expect(out[4].content).toBe('Replaced 1 occurrence.');
  // Quoted by path in a later reply: still in play, so kept whole.
  const quoted = [...messages.slice(0, 5), say('src/a.ts is fixed')];
  expect(elide(quoted, 5).elisions).toEqual([]);
  // A path the todo list still names is kept whole too.
  expect(elide(messages, 5, { protectedPaths: ['src/a.ts'] }).elisions).toEqual([]);
  // Nothing at or after the boundary is touched.
  expect(elide(messages, 2).elisions).toEqual([]);
});

test('E2 and E3: settled and failed commands older than six steps keep their command, exit, and last lines', () => {
  const ok = 'Exit code 0 after 1.2s.\n\nline one is long enough to be worth a stub\nline two\nline three\nline four';
  const bad = 'Exit code 1 after 0.4s.\n\nstdout:\nbuilding\nstderr:\nsrc/x.ts(3,1): error TS2322: no\nl2\nl3\nl4\nl5\nl6';
  const messages = [user('go'), call('c1', 'run_command', { command: 'bun test' }), result('c1', 'run_command', ok), call('c2', 'run_command', { command: 'tsc' }), result('c2', 'run_command', bad), ...steps(7)];
  const young = elide(messages, messages.length, { now: 6 });
  expect(young.elisions).toEqual([]);
  const { messages: out, elisions } = elide(messages, messages.length);
  expect(elisions.map((elision) => [elision.stage, elision.message])).toEqual([
    ['E2', 2],
    ['E3', 4],
  ]);
  expect(out[2].content).toBe('[ran `bun test`, exit 0; last lines:\nline two\nline three\nline four]');
  expect(out[4].content).toBe('[ran `tsc`, exit 1; src/x.ts(3,1): error TS2322: no; last lines:\nl2\nl3\nl4\nl5\nl6]');
});

test('E4: a result identical to an earlier one names the earlier call', () => {
  const listing = Array.from({ length: 12 }, (_, i) => `src/file${i}.ts`).join('\n');
  const messages = [user('go'), call('g1', 'glob', { pattern: '*.ts' }), result('g1', 'glob', listing), call('g2', 'glob', { pattern: '*.ts' }), result('g2', 'glob', listing), say('same')];
  const { messages: out, elisions } = elide(messages, 5);
  expect(elisions).toEqual([{ stage: 'E4', message: 4, tokensRemoved: expect.any(Number), stub: '[same as the result of call g1]' }]);
  expect(out[2].content).toBe(listing);
});

test('E5: a large result older than ten steps keeps its head and tail', () => {
  const big = Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');
  const messages = [user('go'), call('r1', 'read_file', { path: 'big.txt' }), result('r1', 'read_file', big), ...steps(11)];
  expect(elide(messages, messages.length, { now: 10 }).elisions).toEqual([]);
  const { messages: out, elisions } = elide(messages, messages.length);
  expect(elisions.map((elision) => elision.stage)).toEqual(['E5']);
  expect(out[2].content.length).toBeLessThan(1_700);
  expect(out[2].content).toStartWith('line 0 ');
  expect(out[2].content).toEndWith(big.slice(-100));
  expect(out[2].content).toContain('characters removed');
});

test('summaries, the request, and results younger than the boundary are never touched', () => {
  const summary: ChatMessage = { role: 'user', content: 'Summary of the earlier conversation:\nsome', timestamp: 0 };
  const messages = [summary, user('the request'), call('r1', 'read_file', { path: 'a' }), result('r1', 'read_file', 'x'.repeat(5_000)), ...steps(12)];
  const { elisions } = elide(messages, 3);
  expect(elisions).toEqual([]);
});
