import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness } from './harness.js';
import { fitPhrase, isMicro, microPhrase } from '../micro.js';
import { initialView, reduceView } from '../../state/view.js';

const { context, open } = interfaceHarness();

test('the phrase follows priority, names the file or tool at work, and clips to one line', () => {
  let state = initialView();
  expect(microPhrase(state).words).toEqual(['ready']);
  state = reduceView(state, { type: 'submit', text: 'go' });
  state = reduceView(state, { type: 'event', event: { type: 'turn_start', prompt: 'go' } });
  expect(microPhrase(state).words).toEqual(['thinking']);
  state = reduceView(state, { type: 'event', event: { type: 'tool_call', call: { id: 'e1', name: 'edit', arguments: { path: 'src/auth.ts' } } } });
  expect(microPhrase(state).words).toEqual(['editing', 'auth.ts']);
  expect(fitPhrase(microPhrase(state), 12)).toBe('editing');
  expect(fitPhrase(microPhrase(state), 4)).toBe('edit');
  state = reduceView(state, { type: 'event', event: { type: 'tool_call', call: { id: 'r1', name: 'run_command', arguments: { command: 'bun test' } } } });
  expect(microPhrase(state).words).toEqual(['running', 'run_command']);
  state = reduceView(state, { type: 'event', event: { type: 'approval_request', call: { id: 'r1', name: 'run_command', arguments: { command: 'bun test' } }, decide: () => undefined } as any });
  expect(fitPhrase(microPhrase(state), 40)).toBe('need input');
  expect(fitPhrase(microPhrase(state), 6)).toBe('input');
  state = reduceView(state, { type: 'event', event: { type: 'turn_end', status: 'ok' } });
  expect(microPhrase(state).words).toEqual(['done']);
  state = reduceView(state, { type: 'notice', level: 'error', text: 'The provider refused.' });
  expect(microPhrase(state).words).toEqual(['error']);
  expect(isMicro('auto', { width: 80, height: 10 })).toBe(true);
  expect(isMicro('auto', { width: 40, height: 30 })).toBe(true);
  expect(isMicro('auto', { width: 41, height: 11 })).toBe(false);
  expect(isMicro('never', { width: 10, height: 3 })).toBe(false);
  expect(isMicro('always', { width: 200, height: 60 })).toBe(true);
});

test('tiled small, the interface is one still phrase that follows the session; restored, the full view is back as it was', async () => {
  fs.writeFileSync(path.join(context.root, 'a.txt'), 'old\n');
  context.server.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } }] }, { text: 'Edited it.' });
  const { setup, close } = await open({}, { size: { width: 40, height: 8 } });
  try {
    const ready = await frameWith(setup, (frame) => frame.includes('ready'));
    expect(ready.trim()).toBe('ready');
    // Still: two captures over an idle interval are the same.
    await Bun.sleep(300);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toBe(ready);

    await setup.mockInput.typeText('edit a.txt');
    setup.mockInput.pressEnter();
    const asking = await frameWith(setup, (frame) => frame.includes('need input'), 5_000);
    expect(asking.trim()).toBe('need input');
    await setup.mockInput.typeText('1');
    const done = await frameWith(setup, (frame) => frame.trim() === 'done', 5_000);
    expect(done.trim()).toBe('done');

    setup.resize(100, 30);
    const full = await frameWith(setup, (frame) => frame.includes('Edited it.'), 5_000);
    expect(full).toContain('edit a.txt');
  } finally {
    await close();
  }
}, 20_000);
