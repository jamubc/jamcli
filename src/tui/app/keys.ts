import fs from 'fs';
import path from 'path';
import { userConfigDir } from '../../utils/paths.js';

/**
 * The interface's keys, by what they do. A person rebinds them in
 * `~/.config/jamcli/keybindings.json`, which maps an action to a key or a list of keys:
 *
 *     { "cycle_mode": "ctrl+y", "history": ["ctrl+r", "ctrl+s"] }
 *
 * Keys a prompt or a list uses (1 to 4, Up, Down, Tab, Escape to close) are fixed, so
 * they read the same everywhere.
 */
export const KEY_ACTIONS = ['send', 'newline', 'interrupt', 'cycle_mode', 'history', 'tool_detail', 'todos', 'redraw', 'exit', 'help'] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];

export const ACTION_WORDS: Record<KeyAction, string> = {
  send: 'sends the message',
  newline: 'adds a line',
  interrupt: 'stops a running turn',
  cycle_mode: 'changes the permission mode',
  history: 'searches earlier messages',
  tool_detail: 'opens or closes the last tool block',
  todos: 'shows or hides the todo list',
  redraw: 'redraws the screen',
  exit: 'leaves, pressed twice',
  help: 'lists the commands and keys, on an empty composer',
};

export const DEFAULT_KEYS: Record<KeyAction, string[]> = {
  send: ['return'],
  newline: ['shift+return', 'ctrl+j'],
  interrupt: ['escape'],
  cycle_mode: ['shift+tab'],
  history: ['ctrl+r'],
  tool_detail: ['ctrl+o'],
  todos: ['ctrl+t'],
  redraw: ['ctrl+l'],
  exit: ['ctrl+c'],
  help: ['?'],
};

/** One key: a name, such as `return` or `r`, or a character, with its modifiers. */
export interface Chord {
  name: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  /** The words as written, for messages. */
  text: string;
}

/** What a key event carries, as OpenTUI reports it. */
export interface KeyLike {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  option?: boolean;
}

const MODIFIERS = new Set(['ctrl', 'shift', 'meta', 'alt', 'option']);
const NAMED = new Set(['return', 'enter', 'escape', 'tab', 'space', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`)]);

/** A key as written, such as `ctrl+r`, `shift+tab`, or `?`. */
export function parseChord(text: string): Chord | { error: string } {
  const trimmed = text.trim().toLowerCase();
  // A lone character, such as ? or +, is the key itself.
  const parts = trimmed.length === 1 ? [trimmed] : trimmed.split('+').map((part) => part.trim());
  const name = parts.pop() ?? '';
  const chord: Chord = { name: name === 'enter' ? 'return' : name, ctrl: false, shift: false, meta: false, text: text.trim() };
  for (const modifier of parts) {
    if (!MODIFIERS.has(modifier)) return { error: `"${text}" has ${modifier}, which is not a modifier; use ctrl, shift, or alt.` };
    if (modifier === 'ctrl') chord.ctrl = true;
    else if (modifier === 'shift') chord.shift = true;
    else chord.meta = true;
  }
  if (!name || (name.length > 1 && !NAMED.has(name))) return { error: `"${text}" names no key; use a letter or one of ${[...NAMED].slice(0, 15).join(', ')}.` };
  return chord;
}

/** Whether a key event is this chord. A character chord matches what was typed, whatever made it. */
export function matchesChord(key: KeyLike, chord: Chord): boolean {
  const meta = Boolean(key.meta || key.option);
  if (chord.name.length === 1 && !chord.ctrl && !chord.meta && !/[a-z0-9]/.test(chord.name)) return key.sequence === chord.name && !key.ctrl && !meta;
  return key.name === chord.name && Boolean(key.ctrl) === chord.ctrl && Boolean(key.shift) === chord.shift && meta === chord.meta;
}

export type Keybindings = Record<KeyAction, Chord[]>;

export const matchesAction = (bindings: Keybindings, action: KeyAction, key: KeyLike): boolean => bindings[action].some((chord) => matchesChord(key, chord));

export const keybindingsFile = (): string => path.join(userConfigDir(), 'keybindings.json');

/**
 * The keys, with the person's file over the defaults. Anything in the file that does
 * not fit is named, and the default stands for that action.
 */
export function loadKeybindings(file: string = keybindingsFile()): { bindings: Keybindings; problems: string[] } {
  const bindings = Object.fromEntries(KEY_ACTIONS.map((action) => [action, DEFAULT_KEYS[action].map((text) => parseChord(text) as Chord)])) as Keybindings;
  const problems: string[] = [];
  if (!fs.existsSync(file)) return { bindings, problems };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error: any) {
    return { bindings, problems: [`${file} is not valid JSON, so the default keys apply: ${error?.message ?? error}`] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { bindings, problems: [`${file} should map actions to keys, so the default keys apply.`] };
  for (const [action, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEY_ACTIONS.includes(action as KeyAction)) {
      problems.push(`${file}: ${action} is not an action; the actions are ${KEY_ACTIONS.join(', ')}.`);
      continue;
    }
    const texts = Array.isArray(value) ? value : [value];
    const chords: Chord[] = [];
    for (const text of texts) {
      const parsed = typeof text === 'string' ? parseChord(text) : { error: `${JSON.stringify(text)} is not a key.` };
      if ('error' in parsed) problems.push(`${file}: ${action}: ${parsed.error}`);
      else chords.push(parsed);
    }
    if (chords.length === texts.length && chords.length > 0) bindings[action as KeyAction] = chords;
    else if (chords.length === 0 && texts.length === 0) problems.push(`${file}: ${action} has no keys, so its default stands.`);
  }
  // Two actions on one key would make one of them unreachable.
  const seen = new Map<string, KeyAction>();
  for (const action of KEY_ACTIONS) {
    for (const chord of bindings[action]) {
      const id = `${chord.ctrl}${chord.shift}${chord.meta}${chord.name}`;
      const other = seen.get(id);
      if (other && other !== action) problems.push(`${chord.text} is bound to both ${other} and ${action}; ${other} takes it.`);
      else seen.set(id, action);
    }
  }
  return { bindings, problems };
}

const NAME_LABELS: Record<string, string> = { return: 'Enter', escape: 'Escape', tab: 'Tab', space: 'Space', backspace: 'Backspace', pageup: 'Page Up', pagedown: 'Page Down' };

/** A key as help writes it: Ctrl+R, Shift+Tab, Enter, ?. */
export function keyLabel(chord: Chord): string {
  const name = NAME_LABELS[chord.name] ?? (chord.name.length === 1 ? chord.name.toUpperCase() : chord.name[0].toUpperCase() + chord.name.slice(1));
  const shown = chord.name.length === 1 && !/[a-z]/.test(chord.name) ? chord.name : name;
  return [chord.ctrl ? 'Ctrl' : '', chord.meta ? 'Alt' : '', chord.shift ? 'Shift' : '', shown].filter(Boolean).join('+');
}

/** The keys an action is on, for help. */
export const keysFor = (bindings: Keybindings, action: KeyAction): string => bindings[action].map(keyLabel).join(' or ');

/** Every action and its keys, on one line, for the help overlay. */
export const keysHelp = (bindings: Keybindings): string => `Keys: ${KEY_ACTIONS.map((action) => `${keysFor(bindings, action)} ${ACTION_WORDS[action]}`).join(' · ')}`;
