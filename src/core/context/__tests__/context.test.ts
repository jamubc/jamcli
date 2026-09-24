import { expect, test } from 'bun:test';
import {
  SUMMARY_PREFIX,
  TokenCounter,
  chooseBoundary,
  compact,
  contextBudget,
  estimateMessage,
  estimateRequest,
  isContextOverflow,
  isSummary,
  summaryMessage,
} from '../index.js';
import { createScriptedProvider } from '../../../testing/scriptedProvider.js';
import { ProviderError } from '../../providers/http.js';
import type { ChatMessage } from '../../types.js';

const user = (content: string): ChatMessage => ({ role: 'user', content, timestamp: 0 });
const assistant = (content: string, ...calls: string[]): ChatMessage => ({
  role: 'assistant',
  content,
  timestamp: 0,
  ...(calls.length ? { tool_calls: calls.map((id) => ({ id, type: 'function', function: { name: 'read_file', arguments: { path: `${id}.ts` } } })) } : {}),
});
const result = (id: string, content = 'x'.repeat(400)): ChatMessage => ({ role: 'tool', content, tool_call_id: id, toolName: 'read_file', toolStatus: 'ok', timestamp: 0 });

test('the estimate counts text, reasoning, and every tool call', () => {
  expect(estimateMessage(user('abcd'.repeat(10)))).toBe(4 + 10);
  expect(estimateMessage({ ...assistant('ab'), reasoning: 'r'.repeat(40) })).toBe(4 + 1 + 10);
  // Signed reasoning is counted instead of the plain text it duplicates.
  expect(estimateMessage({ ...assistant(''), reasoning: 'r'.repeat(40), reasoningBlocks: [{ type: 'thinking', text: 't'.repeat(80), signature: 's' }] })).toBe(4 + 20);
  const call = assistant('', 'c1');
  expect(estimateMessage(call)).toBe(4 + Math.ceil('read_file'.length / 4) + Math.ceil(JSON.stringify({ path: 'c1.ts' }).length / 4));
  const tools = [{ type: 'function' as const, function: { name: 'read_file', description: 'Read a file.' } }];
  expect(estimateRequest({ system: 'x'.repeat(40), tools, messages: [user('abcd')] })).toBe(4 + 10 + Math.ceil(JSON.stringify(tools).length / 4) + 4 + 1);
});

test('the counter learns how the provider counts, within reason', () => {
  const counter = new TokenCounter();
  const request = { messages: [user('x'.repeat(400))] };
  expect(counter.count(request)).toBe(104);
  counter.observe(104, 156);
  expect(counter.correction).toBe(1.5);
  expect(counter.count(request)).toBe(156);
  // A count far from the estimate is more likely wrong than the estimate.
  counter.observe(104, 5);
  counter.observe(104, 5_000);
  counter.observe(104, undefined);
  expect(counter.correction).toBe(1.5);
});

test('the budget is the window less the output reserve and a tenth, triggering at 85 percent', () => {
  expect(contextBudget(200_000, 32_000)).toEqual({ window: 200_000, outputReserve: 32_000, margin: 20_000, budget: 148_000, trigger: 125_800 });
  // Unknown output: 8,192, or a quarter of a small window.
  expect(contextBudget(1_000_000).outputReserve).toBe(8_192);
  expect(contextBudget(16_384).outputReserve).toBe(4_096);
  // A reserve larger than half the window is taken as half.
  expect(contextBudget(8_192, 32_000)).toMatchObject({ outputReserve: 4_096, budget: 3_277 });
});

test('a cut prefers a user turn, falls inside a long turn only at a step, and never at a tool result', () => {
  const conversation = [
    user('first'),
    assistant('', 'a'),
    result('a'),
    assistant('done first'),
    user('second'),
    assistant('', 'b'),
    result('b'),
    assistant('', 'c'),
    result('c'),
    assistant('done second'),
  ];
  // Room for the whole second turn: cut where it starts.
  expect(chooseBoundary(conversation, 1_000)).toBe(4);
  // Room for only the last steps of the second turn: cut at the start of a step.
  expect(chooseBoundary(conversation, 150)).toBe(7);
  // Room for nothing: keep the last step anyway.
  expect(chooseBoundary(conversation, 1)).toBe(9);
  // Room for everything: keep the latest turn whole, and a single turn is left alone.
  expect(chooseBoundary(conversation, 100_000)).toBe(4);
  expect(chooseBoundary(conversation.slice(4), 100_000)).toBeUndefined();
  // A previous summary alone is not worth summarizing again.
  expect(chooseBoundary([summaryMessage('before', 0), assistant('', 'z'), result('z')], 1)).toBeUndefined();
  expect(chooseBoundary([summaryMessage('before', 0), user('next'), assistant('', 'z'), result('z')], 1)).toBe(2);
});

test('no cut, at any room to keep, parts a tool call from its results', () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 200; trial += 1) {
    const messages: ChatMessage[] = [];
    let call = 0;
    for (let turn = 0; turn < 1 + Math.floor(random() * 4); turn += 1) {
      messages.push(user(`turn ${turn}`));
      for (let step = 0; step < Math.floor(random() * 4); step += 1) {
        const ids = Array.from({ length: 1 + Math.floor(random() * 3) }, () => `call${call++}`);
        messages.push(assistant('', ...ids));
        for (const id of ids) messages.push(result(id, 'y'.repeat(Math.floor(random() * 800))));
      }
      messages.push(assistant('answer'));
    }
    for (const keep of [1, 50, 200, 800, 5_000]) {
      const boundary = chooseBoundary(messages, keep);
      if (boundary === undefined) continue;
      const kept = messages.slice(boundary);
      expect(kept[0].role).not.toBe('tool');
      const calls = new Set(kept.flatMap((message) => (message.tool_calls ?? []).map((toolCall) => toolCall.id)));
      for (const message of kept) if (message.role === 'tool') expect(calls.has(message.tool_call_id)).toBe(true);
    }
  }
});

test('compaction summarizes the older part, keeps the rest verbatim, and asks with the focus', async () => {
  const provider = createScriptedProvider([{ text: 'Notes: read a.ts.', usage: { prompt: 900, completion: 30 } }]);
  const messages = [user('look at a.ts'), assistant('', 'a'), result('a', `${'z'.repeat(5_000)}TAIL`), assistant('It is fine.'), user('now b.ts')];
  const outcome = (await compact({ messages, provider, model: 'm', keepTokens: 20, focus: 'the parser' }))!;
  expect(outcome).toMatchObject({ replaced: 4, strategy: 'summary', summary: 'Notes: read a.ts.', usage: { prompt_tokens: 900 } });
  expect(outcome.messages).toEqual([summaryMessage('Notes: read a.ts.', outcome.messages[0].timestamp), user('now b.ts')]);
  expect(isSummary(outcome.messages[0])).toBe(true);
  expect(outcome.messages[0].content.startsWith(`${SUMMARY_PREFIX}\n`)).toBe(true);

  const asked = provider.calls[0];
  expect(asked.options).toMatchObject({ model: 'm', maxOutputTokens: 8_192 });
  const prompt = asked.messages[0].content;
  expect(prompt).toContain('Give particular attention to: the parser');
  expect(prompt).toContain('TOOL CALL read_file: {"path":"a.ts"}');
  expect(prompt).toContain('TOOL RESULT (read_file, ok):');
  // A long result is cut in the middle, so its end still reaches the summarizer.
  expect(prompt).toContain('TAIL');
  expect(prompt.length).toBeLessThan(4_000);
});

test('a summary that fails leaves the older part out and says why; a cut inside a turn keeps its request', async () => {
  const failing = createScriptedProvider([{ status: 500 }]);
  const turn = [user('refactor the parser'), assistant('', 'a'), result('a'), assistant('', 'b'), result('b')];
  const dropped = (await compact({ messages: turn, provider: failing, keepTokens: 1 }))!;
  expect(dropped.strategy).toBe('drop');
  expect(dropped.error).toContain('500');
  expect(dropped.replaced).toBe(3);
  expect(dropped.summary).toContain('could not be summarized, so it was left out');
  expect(dropped.summary.endsWith('The request being worked on, verbatim:\nrefactor the parser')).toBe(true);
  expect(dropped.messages.slice(1)).toEqual(turn.slice(3));

  // The next compaction carries the request over from the summary it replaces.
  const again = [...dropped.messages, assistant('', 'c'), result('c')];
  const carried = (await compact({ messages: again, provider: createScriptedProvider([{ text: 'Still refactoring.' }]), keepTokens: 1 }))!;
  expect(carried.summary).toBe('Still refactoring.\n\nThe request being worked on, verbatim:\nrefactor the parser');

  // An empty summary is a failed one.
  const empty = (await compact({ messages: turn, provider: createScriptedProvider([{ text: '   ' }]), keepTokens: 1 }))!;
  expect(empty).toMatchObject({ strategy: 'drop', error: 'the summary came back empty' });
});

test('a cancelled compaction stops instead of dropping anything', async () => {
  const controller = new AbortController();
  controller.abort();
  const provider = createScriptedProvider([{ text: 'late', delayMs: 50 }]);
  const turn = [user('go'), assistant('', 'a'), result('a'), assistant('', 'b'), result('b')];
  await expect(compact({ messages: turn, provider, keepTokens: 1, signal: controller.signal })).rejects.toThrow();
  expect(provider.calls).toHaveLength(0);
});

test('a refusal as too long is recognized in the words providers use', () => {
  const refusal = (status: number, detail: string) => new ProviderError({ provider: 'p', status, detail });
  expect(isContextOverflow(refusal(400, "This model's maximum context length is 128000 tokens."))).toBe(true);
  expect(isContextOverflow(refusal(400, 'prompt is too long: 250000 tokens > 200000 maximum'))).toBe(true);
  expect(isContextOverflow(refusal(413, 'Request too long'))).toBe(true);
  expect(isContextOverflow(refusal(400, 'invalid model'))).toBe(false);
  expect(isContextOverflow(refusal(500, 'prompt is too long'))).toBe(false);
  expect(isContextOverflow(new Error('prompt is too long'))).toBe(false);
});
