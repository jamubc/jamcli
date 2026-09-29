import { expect, test } from 'bun:test';
import { commitBreaches, fileBreaches } from '../check-rules.js';

const DASH = '\u2014';

test('a file with an em dash is named by line, and one without passes', () => {
  expect(fileBreaches('a.md', `one\ntwo ${DASH} three\n`)).toEqual(['a.md:2: an em dash; use a colon, a comma, or a full stop']);
  expect(fileBreaches('a.md', 'one: two, three.\n')).toEqual([]);
});

test('commits are conventional, lowercase, and carry neither an em dash nor AI attribution', () => {
  // Subjects from this repository's history, which pass.
  expect(commitBreaches('a', 'fix(ollama): send think only to a model whose capabilities name thinking')).toEqual([]);
  expect(commitBreaches('a', 'feat(tui): Ctrl+O expands every block, and again compacts')).toEqual([]);
  expect(commitBreaches('a', 'docs(openspec): archive add-audit-ledger, close the unit\n\nWhy, in a body.')).toEqual([]);
  // And ones from before the rules, which do not.
  expect(commitBreaches('b', 'Add screenshots to README')).toEqual(['b: "Add screenshots to README" is not a conventional commit (type(scope): description)']);
  expect(commitBreaches('c', 'feat: Add a tool')).toEqual(['c: "feat: Add a tool" opens its description on a capital; commits are lowercase']);
  expect(commitBreaches('d', `fix: a thing ${DASH} and another`)).toEqual(['d: the message has an em dash']);
  expect(commitBreaches('e', 'fix: a thing\n\nCo-Authored-By: Someone <x@y>')).toEqual(["e: the message carries AI attribution; commits carry the owner's identity only"]);
  expect(commitBreaches('f', 'fix: a thing\n\n\u{1F916} Generated with a tool')).toEqual(["f: the message carries AI attribution; commits carry the owner's identity only"]);
});
