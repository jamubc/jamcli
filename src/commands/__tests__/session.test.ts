import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { readTranscript, sessionFileFor } from '../../core/transcript/index.js';
import { flagsOf } from '../../core/wake/index.js';
import { hostFixture, said } from './fixture.js';

const { context, open } = hostFixture();

test('/rename names the session once in the project, and /color colors it until default', async () => {
  const { host, runtime, entries } = await open();
  await host.run('/rename fix auth');
  expect(runtime.name).toBe('fix-auth');
  await host.run('/rename fix/auth');
  expect(said(entries)).toContain('fix/auth is not a name');
  const other = await open();
  await other.host.run('/rename FIX-AUTH');
  expect(said(other.entries)).toContain(`${runtime.sessionId} is already called FIX-AUTH.`);
  await host.run('/color blue');
  expect(runtime.color).toBe('blue');
  await host.run('/color mauve');
  expect(said(entries)).toContain('The color is one of red, orange, yellow, green, cyan, blue, purple, pink, or default, not mauve.');
  await host.run('/color default');
  expect(runtime.color).toBeUndefined();
  const kinds = readTranscript(sessionFileFor(context.root, runtime.sessionId)).map((event) => event.type);
  expect(kinds.filter((kind) => kind === 'name' || kind === 'color')).toEqual(['name', 'color', 'color']);
});

test('/report writes the notes with the model, effort, context, and message, and the log when asked', async () => {
  const { host, runtime, entries } = await open();
  await host.run('/note the picker hid the composer');
  await host.run('/notes');
  expect(said(entries)).toMatch(/Tester notes in this session, oldest first \(1\):\n- \d\d:\d\d the picker hid the composer/);
  await host.run('/report please look at the picker');
  expect(said(entries)).toContain('choice Include the session log in the report?: no yes');
  await host.run('/choose yes');
  const dir = path.join(context.root, '.jamcli', 'reports');
  const [file] = fs.readdirSync(dir);
  expect(file).toStartWith(`${runtime.sessionId}-`);
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  for (const part of ['- Model: ollama:fake-model', '- Effort: auto', '## Context', 'please look at the picker', '## Tester notes (1)', 'the picker hid the composer', '## Session log', sessionFileFor(context.root, runtime.sessionId)]) {
    expect(text).toContain(part);
  }
  expect(said(entries)).toContain(`Wrote .jamcli/reports/${file}: 1 note, with the session log.`);
});

test('/reflect asks how to read the notes first, and sends the framing with the turn; without notes it asks nothing', async () => {
  const quiet = await open();
  await quiet.host.run('/reflect');
  expect(quiet.turns[0].options).toMatchObject({ reflection: { notes: null } });

  const { host, entries, turns } = await open();
  await host.run('/note the picker hid the composer');
  await host.run('/reflect');
  expect(turns).toHaveLength(0);
  expect(said(entries)).toContain('choice How should the reflection read your 1 tester note?: features model bugs out');
  await host.run('/choose bugs');
  expect(turns[0].options).toMatchObject({ reflection: { notes: 'bugs in JamCLI itself' } });
  expect(turns[0].prompt).toContain('framed them as: bugs in JamCLI itself');
});

test('a prompt that names a session by its name is told where that session is, its notes, and its flags', async () => {
  const builder = await open();
  await builder.host.run('/rename builder');
  await builder.host.run('/note the picker hid the composer');
  await builder.host.run('/flag green');
  const { runtime } = await open();
  context.server.enqueue({ text: 'It left a note.' });
  await runtime.run('what did builder see?');
  const asked = String(context.server.completions().at(-1)!.body.messages.at(-1).content);
  expect(asked).toContain('[Sessions named in this message');
  expect(asked).toContain(`- ${builder.runtime.sessionId} (named builder): project ${context.root}, log ${sessionFileFor(context.root, builder.runtime.sessionId)}, 1 tester note (events of type "note"), flags raised: green`);
});

test('/flag raises and lowers flags on the board, and /wake sets, lists, and cancels, going off to whoever listens', async () => {
  const { host, runtime, entries } = await open();
  await host.run('/flag green');
  expect(Object.keys(flagsOf(runtime.sessionId))).toEqual(['green']);
  await host.run('/flag lower green');
  expect(flagsOf(runtime.sessionId)).toEqual({});
  await host.run('/wake in 1s say hello');
  await host.run('/wake when nobody-here raise green: compile');
  expect(said(entries)).toContain('No session named nobody-here.');
  await host.run('/wake in 1h later');
  await host.run('/wake list');
  expect(said(entries)).toMatch(/w1: in \d s, set by the person: say hello\nw2: in \d+ s, set by the person: later/);
  await host.run('/wake cancel w2');
  const fired = await new Promise<string>((resolve) => runtime.onWake((wake) => resolve(wake.text)));
  expect(fired).toContain('say hello');
  expect(runtime.wakes()).toHaveLength(0);
});
