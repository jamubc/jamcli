import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_KEYS, KEY_ACTIONS, keyLabel, keysFor, keysHelp, loadKeybindings, matchesAction, matchesChord, parseChord, type Chord } from '../keys.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-keys-'));
  file = path.join(dir, 'keybindings.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const chord = (text: string) => parseChord(text) as Chord;

test('a key is written with its modifiers, and a lone character is the key itself', () => {
  expect(parseChord('Ctrl+R')).toMatchObject({ name: 'r', ctrl: true, shift: false, meta: false });
  expect(parseChord('shift+tab')).toMatchObject({ name: 'tab', shift: true });
  expect(parseChord('alt+enter')).toMatchObject({ name: 'return', meta: true });
  expect(parseChord('+')).toMatchObject({ name: '+', ctrl: false });
  expect(parseChord('?')).toMatchObject({ name: '?' });
  expect(parseChord('hyper+x')).toEqual({ error: '"hyper+x" has hyper, which is not a modifier; use ctrl, shift, or alt.' });
  expect('error' in parseChord('ctrl+banana')).toBe(true);
  expect('error' in parseChord('ctrl+')).toBe(true);
});

test('a key event matches its chord exactly, and a character chord matches what was typed', () => {
  expect(matchesChord({ name: 'r', ctrl: true }, chord('ctrl+r'))).toBe(true);
  expect(matchesChord({ name: 'r', ctrl: true, shift: true }, chord('ctrl+r'))).toBe(false);
  expect(matchesChord({ name: 'r' }, chord('ctrl+r'))).toBe(false);
  expect(matchesChord({ name: 'tab', shift: true }, chord('shift+tab'))).toBe(true);
  expect(matchesChord({ name: 'return', option: true }, chord('alt+return'))).toBe(true);
  // ? is shift+/ on most keyboards; what matters is the character.
  expect(matchesChord({ name: '/', sequence: '?', shift: true }, chord('?'))).toBe(true);
  expect(matchesChord({ name: '/', sequence: '/' }, chord('?'))).toBe(false);
  expect(matchesChord({ name: 'y', sequence: 'y' }, chord('y'))).toBe(true);
});

test('with no file, the keys are the defaults and every action has one', () => {
  const { bindings, problems } = loadKeybindings(file);
  expect(problems).toEqual([]);
  for (const action of KEY_ACTIONS) expect(bindings[action].map((item) => item.text)).toEqual(DEFAULT_KEYS[action]);
  expect(keysFor(bindings, 'newline')).toBe('Shift+Enter or Ctrl+J');
  expect(keysFor(bindings, 'help')).toBe('?');
  expect(keysHelp(bindings)).toStartWith('Keys: Enter sends the message · Shift+Enter or Ctrl+J adds a line · Escape stops a running turn');
});

test("the person's file replaces an action's keys, and whatever does not fit is named while the default stands", () => {
  fs.writeFileSync(
    file,
    JSON.stringify({
      cycle_mode: 'ctrl+y',
      history: ['ctrl+r', 'ctrl+s'],
      redraw: 'ctrl+nope',
      rewind: 'escape',
      todos: ['ctrl+g', 42],
      tool_detail: 'ctrl+r',
    })
  );
  const { bindings, problems } = loadKeybindings(file);
  expect(bindings.cycle_mode.map(keyLabel)).toEqual(['Ctrl+Y']);
  expect(bindings.history.map(keyLabel)).toEqual(['Ctrl+R', 'Ctrl+S']);
  expect(bindings.redraw.map(keyLabel)).toEqual(['Ctrl+L']);
  expect(bindings.todos.map(keyLabel)).toEqual(['Ctrl+T']);
  expect(problems).toContainEqual(expect.stringContaining('redraw: "ctrl+nope" names no key'));
  expect(problems).toContainEqual(expect.stringContaining('rewind is not an action'));
  expect(problems).toContainEqual(expect.stringContaining('todos: 42 is not a key.'));
  expect(problems).toContainEqual('ctrl+r is bound to both history and tool_detail; history takes it.');
  expect(matchesAction(bindings, 'cycle_mode', { name: 'y', ctrl: true })).toBe(true);
  expect(matchesAction(bindings, 'cycle_mode', { name: 'tab', shift: true })).toBe(false);
});

test('a file that is not JSON, or not an object, leaves the defaults and says so', () => {
  fs.writeFileSync(file, '{ nope');
  expect(loadKeybindings(file).problems[0]).toMatch(/is not valid JSON, so the default keys apply/);
  fs.writeFileSync(file, '["ctrl+r"]');
  expect(loadKeybindings(file).problems[0]).toMatch(/should map actions to keys, so the default keys apply/);
  expect(loadKeybindings(file).bindings.history.map(keyLabel)).toEqual(['Ctrl+R']);
});
