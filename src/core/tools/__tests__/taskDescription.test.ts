import { expect, test } from 'bun:test';
import { taskDescription } from '../task.js';
import { BUILTIN_AGENTS } from '../../ext/agents.js';

test('the built-ins render one line each with the chain they run on, and the default', () => {
  const text = taskDescription([...BUILTIN_AGENTS].sort((a, b) => a.name.localeCompare(b.name)), 'quick');
  expect(text).toContain(
    [
      'Agents (choose by what the work needs):',
      '- explore: Investigation across the codebase: where something lives, how two parts connect, what calls what. Ask it to report, not to edit. (runs on ollama:llama3)',
      '- intelligent: Hard problems where getting it right matters more than speed: a subtle bug, a change that crosses several modules. (runs on ollama:llama3)',
      '- quick: Small, well-specified jobs with a short answer: a lookup, a single-file check, one piece of a fan-out. (runs on ollama:llama3)',
      '- writing: Prose: documentation, a commit message, a summary for the person. (runs on ollama:llama3)',
      'If you omit agent, quick is used.',
    ].join('\n')
  );
  expect(text).toContain('Delegate when:');
  expect(text).toContain('Do it yourself when:');
  expect(text).toContain('Never delegate understanding');
});

test('reasoning shows in the chain, an undescribed agent is name and chain, and no default says to name one', () => {
  const text = taskDescription([
    { name: 'deep', description: 'Hard design.', chain: [{ model: 'openrouter:a', reasoning: 'on' }, { model: 'ollama:b' }] },
    { name: 'fast', chain: [{ model: 'openai:mini' }] },
  ]);
  expect(text).toContain('- deep: Hard design. (runs on openrouter:a (reasoning on) -> ollama:b)');
  expect(text).toContain('- fast: (runs on openai:mini)');
  expect(text).toContain('Always name an agent.');
  expect(text).not.toContain('If you omit agent');
});

test('a default that is not offered is not promised', () => {
  expect(taskDescription([{ name: 'fast', chain: [{ model: 'openai:mini' }] }], 'writing')).toContain('Always name an agent.');
});

test('with no routable agent, the description says so', () => {
  expect(taskDescription([])).toContain('No agent can run: none has a model on a configured provider.');
});
