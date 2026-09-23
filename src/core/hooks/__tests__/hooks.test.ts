import { test, expect } from 'bun:test';
import { createHookBus } from '../index.js';
import { createSession } from '../../state.js';

const payload = (session = createSession('/tmp/hooks-project', 'hooks-test')) => ({
  session,
  prompt: 'hello',
  messages: [],
});

test('a handler receives the payload in registration order', async () => {
  const bus = createHookBus();
  const seen: string[] = [];
  bus.on('turn_start', () => seen.push('first'));
  bus.on('turn_start', () => seen.push('second'));
  await bus.emit('turn_start', payload());
  expect(seen).toEqual(['first', 'second']);
});

test('a throwing handler is recorded and the turn continues', async () => {
  const bus = createHookBus();
  const seen: string[] = [];
  bus.on('turn_start', () => {
    throw new Error('boom');
  }, 'explosive');
  bus.on('turn_start', () => seen.push('after'));
  const failures = await bus.emit('turn_start', payload());
  expect(failures).toEqual([{ event: 'turn_start', handler: 'explosive', message: 'boom' }]);
  expect(seen).toEqual(['after']);
  expect(bus.failures()).toHaveLength(1);
});

test('a rejected async handler is recorded as well', async () => {
  const bus = createHookBus();
  bus.on('post_tool', async () => {
    throw new Error('async boom');
  }, 'async-explosive');
  const failures = await bus.emit('post_tool', {
    session: createSession('/tmp/hooks-project'),
    call: { id: 'c1', name: 'read_file', arguments: {} },
    result: { tool: 'read_file', success: true, output: 'x', durationMs: 1 },
    output: 'x',
  });
  expect(failures[0].message).toBe('async boom');
});

test('a disabled bus emits nothing but keeps its registrations', async () => {
  const bus = createHookBus();
  const seen: string[] = [];
  bus.on('session_start', () => seen.push('ran'));
  bus.disable();
  await bus.emit('session_start', { session: createSession('/tmp/hooks-project') });
  expect(seen).toEqual([]);
  bus.enable();
  await bus.emit('session_start', { session: createSession('/tmp/hooks-project') });
  expect(seen).toEqual(['ran']);
});

test('a handler can be unsubscribed', async () => {
  const bus = createHookBus();
  const seen: string[] = [];
  const off = bus.on('turn_start', () => seen.push('ran'));
  off();
  await bus.emit('turn_start', payload());
  expect(seen).toEqual([]);
});

test('events are isolated from one another', async () => {
  const bus = createHookBus();
  const seen: string[] = [];
  bus.on('turn_start', () => seen.push('turn'));
  bus.on('session_end', () => seen.push('end'));
  await bus.emit('turn_start', payload());
  expect(seen).toEqual(['turn']);
});
