import { expect, test } from 'bun:test';
import { KeepAwake } from '../awake.js';
import { flagName, flagsOf, setFlag } from '../board.js';
import { WakeTable, parseDuration, type FiredWake } from '../table.js';
import type { TranscriptEvent } from '../../transcript/events.js';

/** A table on a clock the test moves, recording what it would write to the log. */
function table(flags: Record<string, Record<string, number>> = {}) {
  let now = 1_000_000;
  const facts: object[] = [];
  const fired: FiredWake[] = [];
  const wakes = new WakeTable({
    record: (fact) => facts.push(fact),
    resolve: (ref) => (ref === 'nobody' ? { error: 'No session named nobody.' } : { id: ref === 'builder' ? '2026-09-30-aaaaaaaa' : ref }),
    flags: (session) => flags[session] ?? {},
    now: () => now,
    intervalMs: 60_000,
  });
  wakes.onFire((wake) => fired.push(wake));
  return { wakes, facts, fired, tick: (ms: number) => ((now += ms), wakes.check()) };
}

test('durations read as a person writes them, and anything else is not one', () => {
  expect(parseDuration('90')).toBe(90);
  expect(parseDuration('10m')).toBe(600);
  expect(parseDuration('1h30m')).toBe(5400);
  expect(parseDuration('2 days')).toBe(172_800);
  expect(parseDuration('soon')).toBeUndefined();
  expect(parseDuration('10m later')).toBeUndefined();
});

test('a timer goes off once its time has passed, with a line that says why, and not before', () => {
  const { wakes, fired, facts, tick } = table();
  const made = wakes.set({ prompt: 'check the deploy', afterSeconds: 600, by: 'model' });
  expect('wake' in made && made.wake.id).toBe('w1');
  tick(599_000);
  expect(fired).toHaveLength(0);
  tick(1_000);
  expect(fired).toHaveLength(1);
  expect(fired[0].text).toBe('[Wake w1 went off: its timer ran out. The model set it 10 minutes ago. Its prompt follows.]\n\ncheck the deploy');
  expect(wakes.list()).toHaveLength(0);
  expect(facts.map((fact: any) => fact.action)).toEqual(['set', 'fire']);
});

test('a flag wait goes off only once every named session has raised the flag', () => {
  const flags: Record<string, Record<string, number>> = {};
  const { wakes, fired, tick } = table(flags);
  const made = wakes.set({ prompt: 'compile the notes', when: { sessions: ['2026-09-29-1a6a254d', 'builder'], flag: 'green' }, by: 'person' });
  expect('wake' in made && made.wake.when).toEqual({ sessions: ['2026-09-29-1a6a254d', '2026-09-30-aaaaaaaa'], flag: 'green' });
  flags['2026-09-29-1a6a254d'] = { green: 1 };
  tick(1_000);
  expect(fired).toHaveLength(0);
  flags['2026-09-30-aaaaaaaa'] = { red: 1 };
  tick(1_000);
  expect(fired).toHaveLength(0);
  flags['2026-09-30-aaaaaaaa'] = { green: 2 };
  tick(1_000);
  expect(fired[0].text).toStartWith('[Wake w1 went off: 2026-09-29-1a6a254d and 2026-09-30-aaaaaaaa have raised green. The person set it');
});

test('what cannot be kept is refused, and nothing is set', () => {
  const { wakes, facts } = table();
  const refused = (spec: Parameters<WakeTable['set']>[0]) => {
    const made = wakes.set(spec);
    return 'error' in made ? made.error : 'set';
  };
  expect(refused({ prompt: 'x', afterSeconds: 0, by: 'model' })).toBe('A timer runs from 1 second to 7 days.');
  expect(refused({ prompt: 'x', afterSeconds: 8 * 86_400, by: 'model' })).toBe('A timer runs from 1 second to 7 days.');
  expect(refused({ prompt: 'x', by: 'model' })).toBe('A wake waits for a time or for flags: give one of the two.');
  expect(refused({ prompt: ' ', afterSeconds: 5, by: 'model' })).toBe('A wake needs a prompt to run.');
  expect(refused({ prompt: 'x', when: { sessions: ['nobody'], flag: 'green' }, by: 'model' })).toBe('No session named nobody.');
  expect(facts).toHaveLength(0);
  for (let index = 0; index < 20; index += 1) wakes.set({ prompt: 'x', afterSeconds: 60, by: 'model' });
  expect(refused({ prompt: 'x', afterSeconds: 60, by: 'model' })).toBe('20 wakes are pending already; cancel one first.');
  expect(wakes.cancel('all')).toHaveLength(20);
});

test('a resumed session sets again what is still ahead, and reports a timer that came due while it was closed', () => {
  const at = (ts: number, event: Partial<Extract<TranscriptEvent, { type: 'wake' }>>) => ({ v: 2, type: 'wake', ts, ...event }) as TranscriptEvent;
  const { wakes, facts, fired, tick } = table();
  const told = wakes.restore([
    at(1, { id: 'w1', action: 'set', prompt: 'long past', at: 500_000, by: 'model' }),
    at(2, { id: 'w2', action: 'set', prompt: 'still ahead', at: 1_060_000, by: 'person' }),
    at(3, { id: 'w3', action: 'set', prompt: 'cancelled', at: 1_060_000, by: 'person' }),
    at(4, { id: 'w3', action: 'cancel' }),
  ]);
  expect(told).toEqual(['Wake w1 came due while this session was closed, so it did not run: long past']);
  expect(facts).toEqual([{ type: 'wake', id: 'w1', action: 'missed' }]);
  expect(wakes.list().map((wake) => wake.id)).toEqual(['w2']);
  tick(60_000);
  expect(fired.map((wake) => wake.id)).toEqual(['w2']);
  // Ids go on from the log, so a new wake never takes an old one's.
  expect('wake' in wakes.set({ prompt: 'next', afterSeconds: 5, by: 'model' }) && wakes.list()[0].id).toBe('w4');
});

test('flags stay on the board until lowered, one lowercase word each', () => {
  expect(flagName('Green')).toEqual({ flag: 'green' });
  expect('error' in flagName('two words')).toBe(true);
  setFlag('2026-09-30-bbbbbbbb', '/project', 'green', true);
  setFlag('2026-09-30-bbbbbbbb', '/project', 'done', true);
  setFlag('2026-09-30-bbbbbbbb', '/project', 'green', false);
  expect(Object.keys(flagsOf('2026-09-30-bbbbbbbb'))).toEqual(['done']);
  expect(flagsOf('2026-09-30-cccccccc')).toEqual({});
});

test('the machine is kept awake while anything holds it, and let go when the last hold does', () => {
  const log: string[] = [];
  const awake = new KeepAwake(() => (log.push('start'), { stop: () => void log.push('stop') }));
  awake.hold('turn', true);
  awake.hold('wakes', true);
  awake.hold('turn', false);
  expect(log).toEqual(['start']);
  awake.hold('wakes', false);
  expect(log).toEqual(['start', 'stop']);
  expect(awake.awake).toBe(false);
});
