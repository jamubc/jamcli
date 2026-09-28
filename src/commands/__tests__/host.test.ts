import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { entryText } from '../host.js';
import { hostFixture, said } from './fixture.js';

const { context, open } = hostFixture();

const userConfig = () => JSON.parse(fs.readFileSync(path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json'), 'utf8'));

test('a command prints what the interface would show', async () => {
  const { host, entries } = await open();
  await host.run('/context');
  expect(entries).toHaveLength(1);
  expect(entries[0].kind).toBe('output');
  expect(said(entries)).toContain('Context:');
});

test('a list waits, and /choose answers it by number or by key', async () => {
  const { host, runtime, entries } = await open();
  await host.run('/effort');
  expect(entries.at(-1)).toMatchObject({ kind: 'choice', answer: 'Answer with /choose <number or key>.' });
  expect(host.waiting?.request.title).toContain('thinks');
  await host.run('/choose high');
  expect(host.waiting).toBeUndefined();
  expect(runtime.thinking).toMatchObject({ effort: 'high' });
  expect(userConfig().effort).toBe('high');

  await host.run('/effort');
  const offered = (entries.at(-1) as { items: { key: string }[] }).items;
  await host.run(`/choose ${offered.findIndex((item) => item.key === 'low') + 1}`);
  expect(userConfig().effort).toBe('low');
});

test('an answer that is not a choice says what the choices are, and the list keeps waiting', async () => {
  const { host, entries } = await open();
  await host.run('/effort');
  await host.run('/choose loudly');
  expect(said(entries)).toContain('loudly is not one of the choices');
  expect(host.waiting).toBeDefined();
  await host.run('/choose none');
  expect(host.waiting).toBeUndefined();
  expect(said(entries)).toContain('without a choice');
});

test('anything else sent closes a waiting list, as Escape does', async () => {
  const { host, entries } = await open();
  await host.run('/effort');
  await host.run('/cost');
  expect(host.waiting).toBeUndefined();
  expect(said(entries)).toContain('was closed without a choice');
});

test('/choose with nothing waiting says so', async () => {
  const { host, entries } = await open();
  await host.run('/choose 1');
  expect(said(entries)).toBe('No list is waiting for an answer.');
});

test('answers given in advance answer the lists in order, and a list with none left is closed', async () => {
  const { host, entries } = await open({ answers: ['medium'], laterInput: false });
  await host.run('/effort');
  expect(userConfig().effort).toBe('medium');
  expect(entries.find((entry) => entry.kind === 'choice')).toMatchObject({ answer: 'Answered in advance: medium.' });
  await host.run('/effort');
  expect(host.waiting).toBeUndefined();
  expect(said(entries)).toContain('no answer was given for it');
});

test("an answer given in advance never answers the person's question", async () => {
  fs.mkdirSync(path.join(context.root, '.jamcli'), { recursive: true });
  fs.writeFileSync(path.join(context.root, '.jamcli', 'config.json'), JSON.stringify({ hooks: { user_prompt_submit: [{ command: 'echo hi' }] } }));
  const { host, runtime, entries } = await open({ answers: ['trust'], laterInput: false });
  await host.run('/hooks trust');
  const asked = entries.find((entry) => entry.kind === 'choice');
  expect(asked).toMatchObject({ kind: 'choice', personOnly: true, title: 'This project configures hooks. Run them?' });
  expect(entryText(asked as any)).toContain('Only the person may answer this.');
  expect(said(entries)).toContain('no answer was given for it');
  expect(runtime.hooks().projectTrusted).toBe(false);
});

test('a command that opens a session says how this surface does it', async () => {
  const { host, entries } = await open();
  await host.run('/clear');
  expect(said(entries)).toContain('Open another session with --resume <id>.');
});

test('bypass is never entered without a screen to confirm it on', async () => {
  const { host, runtime, entries } = await open();
  await host.run('/mode bypass');
  expect(runtime.permissionMode).not.toBe('bypass');
  expect(said(entries)).toContain('only where you can confirm it');
  await host.run('/mode plan');
  expect(runtime.permissionMode).toBe('plan');
});

test('a command that sends a turn hands it to the surface, with its tools, and waits for it', async () => {
  const { host, turns } = await open();
  await host.run('/reflect');
  expect(turns).toHaveLength(1);
  expect(turns[0].options).toMatchObject({ offer: expect.arrayContaining(['propose_lesson']) });
});

test('notes are kept, newest first, and cleared', async () => {
  const { host, entries } = await open();
  await host.run('/note first');
  await host.run('/note second');
  expect(host.notes).toEqual(['second', 'first']);
  expect(said(entries)).toContain('- second\n- first');
  await host.run('/notes clear');
  expect(host.notes).toEqual([]);
});

test('a line that names no command says so', async () => {
  const { host, entries } = await open();
  await host.run('/nonsense');
  expect(said(entries)).toBe('/nonsense is not a command. /help lists them.');
});

test('a list offered as text shows each choice with its key and how to answer', () => {
  const text = entryText({
    kind: 'choice',
    title: 'Pick one',
    items: [
      { key: 'a', label: 'Apple', detail: 'red', current: true },
      { key: 'b', label: 'Banana' },
    ],
    answer: 'Answer with /choose <number or key>.',
  });
  expect(text).toBe(['Pick one', '  1. Apple (in use) · red  [a]', '  2. Banana  [b]', '', 'Answer with /choose <number or key>.'].join('\n'));
});

test('/copy debug copies the session log exactly as it was recorded, every event', async () => {
  let copied = '';
  const { host, runtime, entries } = await open({ copy: async (text) => ((copied = text), 'system') });
  await host.run('/copy debug');
  expect(copied).toBe('');
  expect(said(entries)).toContain('Nothing is recorded yet');
  context.server.enqueue({ text: 'Hello back.' });
  await runtime.run('say hello', () => undefined);
  await host.run('/copy debug');
  const file = fs.readFileSync(path.join(context.root, '.jamcli', 'history', `${runtime.session.id}.jsonl`), 'utf8');
  expect(copied).toBe(file);
  expect(JSON.parse(copied.split('\n')[0])).toMatchObject({ type: 'session', id: runtime.session.id });
  expect(copied).toContain('say hello');
  expect(copied).toContain('"type":"usage"');
  await host.run('/copy debug 3');
  expect(said(entries)).toContain('Usage: /copy');
});
