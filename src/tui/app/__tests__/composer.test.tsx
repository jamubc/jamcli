import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness } from './harness.js';

const { context, open } = interfaceHarness();
const FIXTURE = path.join(import.meta.dir, '../../../testing/modernMcpServer.ts');
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };

test('an MCP prompt runs as /server:prompt, and @ completes a resource the turn then includes', async () => {
  fs.mkdirSync(path.join(context.root, '.jamcli'), { recursive: true });
  fs.writeFileSync(path.join(context.root, '.jamcli', 'mcp.json'), JSON.stringify({ servers: [{ id: 'modern', command: 'bun', args: [FIXTURE], enabled: true }] }));
  context.server.enqueue({ text: 'Reviewed.' }, { text: 'Summarized.' });
  const { setup, close } = await open({ mcp: undefined, env }, { size: { width: 110, height: 40 } });
  try {
    await setup.mockInput.typeText('/modern:re');
    expect(await frameWith(setup, (frame) => frame.includes('/modern:review'), 10_000)).toMatch(/\/modern:review <file> \[focus\]/);
    await setup.mockInput.typeText('view a.ts');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Reviewed.'), 10_000);
    expect(context.server.completions().at(-1)!.body.messages.at(-1).content).toBe('Review a.ts.');

    await setup.mockInput.typeText('summarize @docs');
    await frameWith(setup, (frame) => frame.includes('modern:docs://readme'), 5_000);
    setup.mockInput.pressTab();
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Summarized.'), 10_000);
    const sent = context.server.completions().at(-1)!.body.messages.at(-1).content;
    expect(sent).toStartWith('summarize @modern:docs://readme');
    expect(sent).toContain('README: build with bun.');
  } finally {
    await close();
  }
}, 30_000);

test('a line that starts with ! runs as a command, asks first, and the model is not called', async () => {
  const { setup, close } = await open({}, { size: { width: 110, height: 40 } });
  try {
    const before = context.server.completions().length;
    await setup.mockInput.typeText('!echo from-the-composer');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => /allow/i.test(frame) && frame.includes('echo from-the-composer'), 5_000);
    await setup.mockInput.typeText('y');
    await frameWith(setup, (frame) => frame.split('from-the-composer').length > 2, 5_000);
    expect(context.server.completions().length).toBe(before);
  } finally {
    await close();
  }
}, 20_000);

test('with an observer attached, it hears the turn\'s events and each session opened, and the view is unchanged', async () => {
  const events: string[] = [];
  const attached: string[] = [];
  const observer = { event: (event: { type: string }) => void events.push(event.type), attach: (runtime: { sessionId: string }) => void attached.push(runtime.sessionId) };
  context.server.enqueue({ text: 'Observed.' });
  const { setup, close, current } = await open({}, { size: { width: 110, height: 40 }, observer: observer as any });
  try {
    await setup.mockInput.typeText('hello');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Observed.'), 5_000);
    expect(events).toContain('turn_start');
    expect(events).toContain('turn_end');
    await setup.mockInput.typeText('/clear');
    setup.mockInput.pressEnter();
    await frameWith(setup, () => attached.length === 2, 5_000);
    expect(attached[1]).toBe(current().sessionId);
  } finally {
    await close();
  }
}, 20_000);

test('an email in the composer is sent, not completed as a reference', async () => {
  fs.writeFileSync(path.join(context.root, 'b.ts'), 'export {};\n');
  context.server.enqueue({ text: 'Sent as typed.' });
  const { setup, close } = await open({}, { size: { width: 110, height: 40 } });
  try {
    await setup.mockInput.typeText('mail a@b');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Sent as typed.'), 5_000);
    expect(context.server.completions().at(-1)!.body.messages.at(-1).content).toBe('mail a@b');
  } finally {
    await close();
  }
}, 20_000);

test('Enter completes the open reference list instead of sending', async () => {
  fs.writeFileSync(path.join(context.root, 'src.ts'), 'export {};\n');
  context.server.enqueue({ text: 'Sent the file.' });
  const { setup, close } = await open({}, { size: { width: 110, height: 40 } });
  try {
    await setup.mockInput.typeText('@src');
    await frameWith(setup, (frame) => frame.includes('@src.ts'), 5_000);
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('@src.ts '), 2_000);
    expect(context.server.completions().length).toBe(0);
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Sent the file.'), 5_000);
    expect(context.server.completions().at(-1)!.body.messages.at(-1).content).toContain('File src.ts');
  } finally {
    await close();
  }
}, 20_000);

test('Escape closes the reference list, so Enter sends what was typed', async () => {
  fs.mkdirSync(path.join(context.root, 'src'));
  fs.writeFileSync(path.join(context.root, 'src', 'a.ts'), 'export {};\n');
  context.server.enqueue({ text: 'Sent the text.' });
  const { setup, close } = await open({}, { size: { width: 110, height: 40 } });
  try {
    await setup.mockInput.typeText('@src');
    await frameWith(setup, (frame) => frame.includes('src/a.ts'), 5_000);
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => !frame.includes('Tab or Enter completes'), 2_000);
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Sent the text.'), 5_000);
    expect(context.server.completions().at(-1)!.body.messages.at(-1).content).toBe('@src');
  } finally {
    await close();
  }
}, 20_000);

test('completing a directory leaves the cursor inside it', async () => {
  fs.mkdirSync(path.join(context.root, 'src'));
  fs.writeFileSync(path.join(context.root, 'src', 'a.ts'), 'export {};\n');
  context.server.enqueue({ text: 'Sent the file.' });
  const { setup, close } = await open({}, { size: { width: 110, height: 40 } });
  try {
    await setup.mockInput.typeText('@src');
    await frameWith(setup, (frame) => frame.includes('src/a.ts'), 5_000);
    setup.mockInput.pressTab();
    await setup.mockInput.typeText('a');
    await frameWith(setup, (frame) => frame.includes('@src/a.ts'), 2_000);
    setup.mockInput.pressTab();
    await frameWith(setup, (frame) => frame.includes('@src/a.ts '), 2_000);
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Sent the file.'), 5_000);
    expect(context.server.completions().at(-1)!.body.messages.at(-1).content).toContain('File src/a.ts');
  } finally {
    await close();
  }
}, 20_000);

test('a server whose resource listing fails still leaves file completion working', async () => {
  fs.mkdirSync(path.join(context.root, 'src'));
  fs.writeFileSync(path.join(context.root, 'src', 'a.ts'), 'export {};\n');
  fs.mkdirSync(path.join(context.root, '.jamcli'), { recursive: true });
  fs.writeFileSync(path.join(context.root, '.jamcli', 'mcp.json'), JSON.stringify({ servers: [{ id: 'broken', command: 'bun', args: ['--version'], enabled: true }] }));
  const { setup, close } = await open({ mcp: undefined, env }, { size: { width: 110, height: 40 } });
  try {
    await setup.mockInput.typeText('@src');
    const frame = await frameWith(setup, (shown) => shown.includes('src/a.ts'), 10_000);
    expect(frame).toContain('@src/');
  } finally {
    await close();
  }
}, 30_000);

test('a lone ! is sent as text, not run as an empty command', async () => {
  context.server.enqueue({ text: 'Noted.' });
  const { setup, close } = await open({}, { size: { width: 110, height: 40 } });
  try {
    await setup.mockInput.typeText('!');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Noted.'), 5_000);
    expect(context.server.completions().length).toBe(1);
    expect(context.server.completions()[0].body.messages.at(-1).content).toBe('!');
  } finally {
    await close();
  }
}, 20_000);
