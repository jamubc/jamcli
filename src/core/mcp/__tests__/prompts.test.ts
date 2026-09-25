import { expect, test } from 'bun:test';
import { promptArguments, promptHint } from '../prompts.js';

const review = { arguments: [{ name: 'file', required: true }, { name: 'focus' }] };
const three = { arguments: [{ name: 'a', required: true }, { name: 'b' }, { name: 'c', required: true }] };

const cases: { name: string; text: string; prompt?: typeof review; args: Record<string, string>; missing: string[] }[] = [
  { name: 'bare words fill declared arguments in order', text: 'a.ts tests', args: { file: 'a.ts', focus: 'tests' }, missing: [] },
  { name: 'the last open argument takes the rest of the words', text: 'a.ts for the tests', args: { file: 'a.ts', focus: 'for the tests' }, missing: [] },
  { name: 'a declared name=value fills that argument', text: 'focus=later a.ts', args: { focus: 'later', file: 'a.ts' }, missing: [] },
  { name: 'an undeclared name=value stays positional', text: 'name=value', args: { file: 'name=value' }, missing: [] },
  { name: 'quotes keep spaces', text: '"a b" \'c d\'', args: { file: 'a b', focus: 'c d' }, missing: [] },
  { name: 'missing lists required arguments only', text: '', prompt: three, args: {}, missing: ['a', 'c'] },
  { name: 'a filled required argument is not missing', text: 'a.ts', args: { file: 'a.ts' }, missing: [] },
];

for (const c of cases) {
  test(`prompt arguments: ${c.name}`, () => {
    expect(promptArguments(c.prompt ?? review, c.text)).toEqual({ args: c.args, missing: c.missing });
  });
}

test('prompt hint: required arguments in angle brackets, optional in square brackets', () => {
  expect(promptHint(review)).toBe('<file> [focus]');
});
