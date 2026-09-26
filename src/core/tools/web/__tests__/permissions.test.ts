import { expect, test } from 'bun:test';
import { PermissionEngine } from '../../../permissions/engine.js';
import { parseRule } from '../../../permissions/rules.js';
import { subjectsOf } from '../../../permissions/subjects.js';

const call = { id: 'w1', name: 'web_search', arguments: { query: 'anything' } };
const rule = (text: string) => {
  const parsed = parseRule(text, 'allow', 'project', 'test');
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.rule;
};

test('a web_search call yields the configured provider host as its subject', () => {
  expect(subjectsOf(call, 'web_search', '/tmp', { webSearchHost: 'api.langsearch.com' }).subjects).toEqual([
    { kind: 'domain', value: 'api.langsearch.com' },
  ]);
});

test('with no provider host there is no subject, so a domain rule cannot silently match', () => {
  expect(subjectsOf(call, 'web_search', '/tmp').subjects).toEqual([]);
});

test('web_search(domain:...) decides the call through the engine', () => {
  const engine = new PermissionEngine({
    projectRoot: '/tmp',
    webSearchHost: 'api.langsearch.com',
    classOf: () => 'network',
    namesOf: (name) => [name],
    rules: [rule('web_search(domain:api.langsearch.com)')],
  });
  const verdict = engine.decide(call);
  expect(verdict.decision).toBe('allow');
  expect(verdict.rule).toBe('web_search(domain:api.langsearch.com)');
});

test('a rule naming a different host does not decide it, and the mode asks', () => {
  const engine = new PermissionEngine({
    projectRoot: '/tmp',
    webSearchHost: 'api.langsearch.com',
    classOf: () => 'network',
    namesOf: (name) => [name],
    rules: [rule('web_search(domain:example.com)')],
  });
  expect(engine.decide(call).decision).toBe('ask');
});
