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
    await setup.mockInput.typeText('!printf from-the-composer');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => /allow/i.test(frame) && frame.includes('printf from-the-composer'), 5_000);
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

test('a # note is confirmed, appended through a tool call, and Escape leaves the file alone', async () => {
  const agents = path.join(context.root, 'AGENTS.md');
  fs.writeFileSync(agents, '# Rules\n\nBe kind.\n');
  const { setup, close } = await open({}, { size: { width: 110, height: 40 } });
  try {
    const before = context.server.completions().length;
    await setup.mockInput.typeText('#Always run the tests.');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Append to AGENTS.md?') && frame.includes('Add it'), 5_000);
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => !frame.includes('Append to AGENTS.md?'), 2_000);
    expect(fs.readFileSync(agents, 'utf8')).toBe('# Rules\n\nBe kind.\n');

    // Choosing "Do not" leaves it alone too.
    await setup.mockInput.typeText('#Always run the tests.');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Append to AGENTS.md?'), 5_000);
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => !frame.includes('Append to AGENTS.md?'), 2_000);
    expect(fs.readFileSync(agents, 'utf8')).toBe('# Rules\n\nBe kind.\n');

    await setup.mockInput.typeText('#Always run the tests.');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Append to AGENTS.md?'), 5_000);
    setup.mockInput.pressEnter();
    // The note goes through the edit tool, which asks like any edit in default mode.
    await frameWith(setup, (frame) => frame.includes('Allow edit AGENTS.md?'), 5_000);
    setup.mockInput.typeText('1');
    await frameWith(setup, (frame) => frame.includes('✓ edit AGENTS.md'), 5_000);
    expect(fs.readFileSync(agents, 'utf8')).toBe('# Rules\n\nBe kind.\nAlways run the tests.\n');
    expect(context.server.completions().length).toBe(before);
  } finally {
    await close();
  }
}, 30_000);

test('the observer hears every event of a turn, in order', async () => {
  const events: string[] = [];
  const observer = { event: (event: { type: string }) => void events.push(event.type), attach: () => undefined };
  context.server.enqueue({ toolCalls: [{ id: 'g1', name: 'glob', arguments: { pattern: '*.txt' } }] }, { text: 'Found it.' });
  const { setup, close } = await open({}, { size: { width: 110, height: 40 }, observer: observer as any });
  try {
    await setup.mockInput.typeText('list files');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Found it.'), 5_000);
    const heard = events.filter((type) => ['turn_start', 'tool_call', 'tool_result', 'text', 'turn_end'].includes(type));
    expect(heard.filter((type, index) => type !== heard[index - 1])).toEqual(['turn_start', 'tool_call', 'tool_result', 'text', 'turn_end']);
  } finally {
    await close();
  }
}, 20_000);

test('every line sent from the composer is recorded as typed: a message, a slash line, a shell line, a note, and a queued message', async () => {
  fs.writeFileSync(path.join(context.root, 'README.md'), 'README: build with bun.\n');
  const { setup, runtime, close } = await open({}, { size: { width: 110, height: 40 } });
  try {
    const typed = () => runtime.prompts().map((prompt) => [prompt.text, prompt.state]);

    await setup.mockInput.typeText('/help');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Keys:'));
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => !frame.includes('Keys:'));
    expect(typed()).toEqual([['/help', 'sent']]);

    // An @ reference is expanded for the model; the record keeps what was typed.
    context.server.enqueue({ text: 'Read it.', delayMs: 800 }, { text: 'Queued reply.' });
    await setup.mockInput.typeText('read @README.md ');
    setup.mockInput.pressEnter();
    await setup.mockInput.typeText('and then this');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('queued, ↓ edit'));
    await frameWith(setup, (frame) => frame.includes('Queued reply.'));
    expect(context.server.completions()[0].body.messages.at(-1).content).toContain('README: build with bun.');
    expect(typed()).toEqual([
      ['/help', 'sent'],
      ['read @README.md', 'sent'],
      ['and then this', 'sent'],
    ]);

    await setup.mockInput.typeText('!printf recorded');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => /allow/i.test(frame) && frame.includes('printf recorded'));
    await setup.mockInput.typeText('4');
    await frameWith(setup, (frame) => !frame.includes('Allow run_command'));

    await setup.mockInput.typeText('#remember the fixture');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Append to AGENTS.md?'));
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => !frame.includes('Append to AGENTS.md?'));

    expect(typed().slice(3)).toEqual([
      ['!printf recorded', 'sent'],
      ['#remember the fixture', 'sent'],
    ]);
    // None of it reached the model as a message of its own beyond what was sent as one.
    expect(runtime.session.messages.filter((message) => message.role === 'user').map((message) => String(message.content)).join('\n')).not.toContain('/help');
  } finally {
    await close();
  }
}, 40_000);

/** The text in the composer's box: its rows between the frame's borders, without the transcript's. */
const inComposer = (frame: string): string[] => {
  const rows = frame.split('\n');
  const lastRow = (test: (row: string, index: number) => boolean) => rows.map((row, index) => (test(row, index) ? index : -1)).reduce((a, b) => Math.max(a, b), -1);
  const bottom = lastRow((row) => row.startsWith('└'));
  const top = lastRow((row, index) => index < bottom && row.startsWith('┌'));
  return rows.slice(top + 1, bottom).map((row) => row.replace(/^│ ?/, '').replace(/ *│$/, ''));
};
/** An empty composer shows its invitation in place of text. */
const EMPTY = 'Message JamCLI · / commands · ? help';
const composerHolds = (text: string) => (frame: string) => inComposer(frame).join('\n').trimEnd() === text;

async function say(setup: any, text: string, reply: string) {
  context.server.enqueue({ text: reply });
  await setup.mockInput.typeText(text);
  setup.mockInput.pressEnter();
  await frameWith(setup, (frame) => frame.includes(reply));
}

test('Up recalls the last prompt over a draft, older ones follow, and Down and Escape bring the draft back', async () => {
  const { setup, close } = await open({}, { size: { width: 100, height: 30 } });
  try {
    await say(setup, 'one', 'reply one');
    await say(setup, 'two', 'reply two');
    await setup.mockInput.typeText('my draft');
    setup.mockInput.pressArrow('up');
    const newest = await frameWith(setup, (frame) => composerHolds('two')(frame) && frame.includes('history 1/2 · sent'));
    expect(newest).toContain('↑ older');
    setup.mockInput.pressArrow('up');
    await frameWith(setup, composerHolds('one'));
    setup.mockInput.pressArrow('up');
    const oldest = await frameWith(setup, (frame) => composerHolds('one')(frame) && frame.includes('history 2/2'));
    expect(oldest).not.toContain('↑ older');
    setup.mockInput.pressArrow('down');
    await frameWith(setup, composerHolds('two'));
    setup.mockInput.pressArrow('down');
    const back = await frameWith(setup, (frame) => composerHolds('my draft')(frame) && !frame.includes('history '));
    expect(back).not.toContain('history ');

    setup.mockInput.pressArrow('up');
    await frameWith(setup, composerHolds('two'));
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => composerHolds('my draft')(frame) && !frame.includes('history '));
  } finally {
    await close();
  }
}, 30_000);

test('a prompt sent with several lines comes back with all of them', async () => {
  const { setup, close } = await open({}, { size: { width: 100, height: 30 } });
  try {
    context.server.enqueue({ text: 'reply' });
    await setup.mockInput.pasteBracketedText('first line\nsecond line\n  indented third');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('reply'));
    setup.mockInput.pressArrow('up');
    await frameWith(setup, composerHolds('first line\nsecond line\n  indented third'));
  } finally {
    await close();
  }
}, 30_000);

test('with several lines in the composer, Up walks to the top line before it recalls anything', async () => {
  const { setup, close } = await open({}, { size: { width: 100, height: 30 } });
  try {
    await say(setup, 'earlier', 'reply');
    await setup.mockInput.pasteBracketedText('alpha\nbeta\ngamma');
    setup.mockInput.pressArrow('up');
    setup.mockInput.pressArrow('up');
    const moved = await frameWith(setup, () => true);
    expect(moved).not.toContain('history ');
    expect(inComposer(moved).join('\n')).toContain('alpha\nbeta\ngamma');
    setup.mockInput.pressArrow('up');
    await frameWith(setup, composerHolds('earlier'));
    // The draft is kept: Escape returns all three lines.
    setup.mockInput.pressEscape();
    await frameWith(setup, composerHolds('alpha\nbeta\ngamma'));
  } finally {
    await close();
  }
}, 30_000);

test('a recalled slash line shows no command list, and Up goes on to the prompt before it', async () => {
  const { setup, close } = await open({}, { size: { width: 100, height: 30 } });
  try {
    await say(setup, 'before', 'reply');
    await setup.mockInput.typeText('/help');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Keys:'));
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => !frame.includes('Keys:'));
    setup.mockInput.pressArrow('up');
    const slash = await frameWith(setup, composerHolds('/help'));
    expect(slash).not.toContain('Commands (');
    setup.mockInput.pressArrow('up');
    await frameWith(setup, composerHolds('before'));
  } finally {
    await close();
  }
}, 30_000);

test('sending a recalled prompt sends it as it is and leaves no walk or draft behind', async () => {
  const { setup, runtime, close } = await open({}, { size: { width: 100, height: 30 } });
  try {
    await say(setup, 'one', 'reply one');
    await setup.mockInput.typeText('unsent draft');
    setup.mockInput.pressArrow('up');
    await frameWith(setup, composerHolds('one'));
    context.server.enqueue({ text: 'reply again' });
    setup.mockInput.pressEnter();
    const sent = await frameWith(setup, (frame) => frame.includes('reply again'));
    expect(sent).not.toContain('history ');
    await frameWith(setup, composerHolds(EMPTY));
    expect(runtime.session.messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual(['one', 'one']);
    // The draft went with the send: Down has nothing to bring back.
    setup.mockInput.pressArrow('down');
    await frameWith(setup, composerHolds(EMPTY));
  } finally {
    await close();
  }
}, 30_000);

test('the exit key stops a running turn first, and leaves the draft as it was', async () => {
  let exited = 0;
  const { setup, close } = await open({}, { size: { width: 100, height: 30 }, onExit: () => void (exited += 1) });
  try {
    context.server.enqueue({ text: 'Too late.', delayMs: 3_000 });
    await setup.mockInput.typeText('first');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => /thinking|streaming/.test(frame));
    await setup.mockInput.typeText('still typing');
    setup.mockInput.pressCtrlC();
    const stopped = await frameWith(setup, (frame) => composerHolds('still typing')(frame) && frame.includes('ready'));
    expect(stopped).not.toContain('Press Ctrl+C again');
    expect(exited).toBe(0);
  } finally {
    await close();
  }
}, 30_000);

test('the exit key clears a draft before it counts toward leaving, and Up brings the draft back', async () => {
  let exited = 0;
  const { setup, runtime, close } = await open({}, { size: { width: 100, height: 30 }, onExit: () => void (exited += 1) });
  try {
    await setup.mockInput.typeText('half a thought');
    setup.mockInput.pressCtrlC();
    const cleared = await frameWith(setup, composerHolds(EMPTY));
    expect(cleared).not.toContain('Press Ctrl+C again');
    expect(exited).toBe(0);
    expect(runtime.prompts().map((prompt) => [prompt.text, prompt.state])).toEqual([['half a thought', 'cleared']]);

    // Only an empty composer counts toward leaving.
    setup.mockInput.pressCtrlC();
    await frameWith(setup, (frame) => frame.includes('Press Ctrl+C again to exit.'));
    expect(exited).toBe(0);

    // The cleared text is not lost: it is the newest thing Up recalls.
    setup.mockInput.pressArrow('up');
    const back = await frameWith(setup, (frame) => composerHolds('half a thought')(frame) && frame.includes('cleared'));
    expect(back).toContain('history 1/1');
    setup.mockInput.pressCtrlC();
    await frameWith(setup, composerHolds(EMPTY));
    // The prompt was in history already, so clearing it again adds nothing.
    expect(runtime.prompts()).toHaveLength(1);
    expect(exited).toBe(0);
  } finally {
    await close();
  }
}, 30_000);

test('clearing while walking through earlier prompts ends the walk and keeps the draft that was set aside', async () => {
  const { setup, runtime, close } = await open({}, { size: { width: 100, height: 30 } });
  try {
    await say(setup, 'one', 'reply one');
    await setup.mockInput.typeText('my draft');
    setup.mockInput.pressArrow('up');
    await frameWith(setup, (frame) => composerHolds('one')(frame) && frame.includes('history 1/1'));
    setup.mockInput.pressCtrlC();
    await frameWith(setup, (frame) => composerHolds(EMPTY)(frame) && !frame.includes('history '));
    expect(runtime.prompts().map((prompt) => [prompt.text, prompt.state])).toEqual([
      ['one', 'sent'],
      ['my draft', 'cleared'],
    ]);
  } finally {
    await close();
  }
}, 30_000);

test('Up recalls the prompts from before a /compact, and from a session that is resumed', async () => {
  const { setup, runtime, current, close } = await open({}, { size: { width: 100, height: 30 } });
  try {
    const first = runtime.sessionId;
    const header = (frame: string) => frame.split('\n')[0];
    await say(setup, 'one', 'reply one');
    await say(setup, 'two', 'reply two');
    context.server.enqueue({ text: 'A summary of one and two.' });
    await setup.mockInput.typeText('/compact');
    setup.mockInput.pressEnter();
    for (let wait = 0; wait < 300 && !runtime.session.messages.some((message) => String(message.content).startsWith('Summary of the earlier conversation')); wait += 1) {
      await setup.renderOnce();
      await Bun.sleep(20);
    }
    expect(runtime.session.messages.some((message) => String(message.content).startsWith('Summary of the earlier conversation'))).toBe(true);

    // The conversation was summarized; what was typed was not.
    for (const expected of ['/compact', 'two', 'one']) {
      setup.mockInput.pressArrow('up');
      await frameWith(setup, composerHolds(expected));
    }
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => composerHolds(EMPTY)(frame) && !frame.includes('history '));

    // A new session starts with none of them; resuming the first brings them back.
    await setup.mockInput.typeText('/clear');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => !header(frame).includes(first));
    setup.mockInput.pressArrow('up');
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain('history ');
    await setup.mockInput.typeText(`/resume ${first}`);
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => header(frame).includes(first));
    expect(current().sessionId).toBe(first);
    for (const expected of ['/clear', '/compact', 'two', 'one']) {
      setup.mockInput.pressArrow('up');
      await frameWith(setup, composerHolds(expected));
    }
  } finally {
    await close();
  }
}, 60_000);
