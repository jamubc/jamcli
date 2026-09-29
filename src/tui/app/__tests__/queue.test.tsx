import { expect, test } from 'bun:test';
import { frameWith, interfaceHarness } from './harness.js';

const { context, open } = interfaceHarness();
const size = { width: 100, height: 30 };

test('a message sent while a turn runs waits under the transcript, and is sent once the turn ends', async () => {
  const { setup, close } = await open({}, { size });
  try {
    context.server.enqueue({ text: 'First answer.', delayMs: 1_500 }, { text: 'Second answer.' });
    await setup.mockInput.typeText('first');
    setup.mockInput.pressEnter();
    await setup.mockInput.typeText('second');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('↳ second · queued, ↓ edit'));
    const after = await frameWith(setup, (frame) => frame.includes('Second answer.'));
    expect(after).toContain('> second');
    expect(after).not.toContain('queued, ↓ edit');
    expect(context.server.completions().length).toBe(2);
  } finally {
    await close();
  }
}, 20_000);

test('Down on an empty composer takes the queued message back to edit, and it is not sent', async () => {
  const { setup, close } = await open({}, { size });
  try {
    context.server.enqueue({ text: 'First answer.', delayMs: 1_500 }, { text: 'Unexpected.' });
    await setup.mockInput.typeText('first');
    setup.mockInput.pressEnter();
    await setup.mockInput.typeText('second, with a typo');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('queued, ↓ edit'));
    setup.mockInput.pressArrow('down');
    const back = await frameWith(setup, (frame) => !frame.includes('queued, ↓ edit') && /│ second, with a typo/.test(frame));
    expect(back).not.toContain('↳ second');
    await frameWith(setup, (frame) => frame.includes('First answer.') && frame.includes('ready'));
    await Bun.sleep(200);
    expect(context.server.completions().length).toBe(1);
  } finally {
    await close();
  }
}, 20_000);

test('stopping the turn puts what was queued back in the composer, unsent', async () => {
  const { setup, close } = await open({}, { size });
  try {
    context.server.enqueue({ text: 'Too late.', delayMs: 3_000 }, { text: 'Unexpected.' });
    await setup.mockInput.typeText('first');
    setup.mockInput.pressEnter();
    await setup.mockInput.typeText('second');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('queued, ↓ edit'));
    setup.mockInput.pressEscape();
    const stopped = await frameWith(setup, (frame) => frame.includes('Stopped.') && /│ second/.test(frame));
    expect(stopped).not.toContain('queued, ↓ edit');
    await Bun.sleep(200);
    expect(context.server.completions().length).toBe(1);
  } finally {
    await close();
  }
}, 20_000);

test('a message sent while /compact runs waits for it, then is sent', async () => {
  const { setup, close } = await open({}, { size });
  try {
    for (let i = 1; i <= 4; i++) context.server.enqueue({ text: `Answer ${i}.` });
    for (let i = 1; i <= 4; i++) {
      await setup.mockInput.typeText(`question ${i}`);
      setup.mockInput.pressEnter();
      await frameWith(setup, (frame) => frame.includes(`Answer ${i}.`) && frame.includes('ready'));
    }
    context.server.enqueue({ text: 'The summary.', delayMs: 1_500 }, { text: 'My name is JamCLI.' });
    await setup.mockInput.typeText('/compact');
    setup.mockInput.pressEnter();
    await Bun.sleep(200);
    await setup.mockInput.typeText('what is your name?');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('↳ what is your name? · queued, ↓ edit'));
    const done = await frameWith(setup, (frame) => frame.includes('My name is JamCLI.'), 8_000);
    expect(done).not.toContain('already running');
  } finally {
    await close();
  }
}, 30_000);
