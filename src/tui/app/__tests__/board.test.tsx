import { expect, spyOn, test } from 'bun:test';
import { frameWith, interfaceHarness } from './harness.js';

const { context, open } = interfaceHarness();
const size = { width: 110, height: 44 };

test('a child agent shows on the board with what it is doing and what it cost, and Down then Enter looks in on it', async () => {
  const { setup, close } = await open({ allowTools: ['task'] }, { size });
  try {
    // The child takes a while to answer, so its run can be watched and opened while it is still running.
    context.server.enqueue(
      { toolCalls: [{ id: 't1', name: 'task', arguments: { agent: 'quick', prompt: 'count the files in src' } }], usage: { prompt: 100, completion: 10 } },
      // The child's first step is a read, held long enough to look in and speak to it; what was said reaches it with that step's result.
      { toolCalls: [{ id: 'g1', name: 'glob', arguments: { pattern: '*.ts' } }], delayMs: 2_500, usage: { prompt: 100, completion: 10 } },
      { text: 'There are twelve files.', usage: { prompt: 200, completion: 10 } },
      { text: 'The child counted twelve.', usage: { prompt: 100, completion: 10 } }
    );
    await setup.mockInput.typeText('delegate it');
    setup.mockInput.pressEnter();
    // The board appears on its own: the running child, its agent, its task, and its activity behind a rail.
    const board = await frameWith(setup, (frame) => frame.includes('Agents 1 running') && frame.includes('◐ quick count the files in src'));
    expect(board).toMatch(/│ (thinking|starting)/);
    // The header says how to choose one; Down chooses it, and the row itself then says what Enter does.
    expect(board).toContain('↓ choose an agent, Enter looks in');
    setup.mockInput.pressArrow('down');
    await frameWith(setup, (frame) => frame.includes('· Enter looks in') && !frame.includes('↓ choose an agent'));
    setup.mockInput.pressEnter();
    const viewer = await frameWith(setup, (frame) => frame.includes('type below to talk to it'));
    expect(viewer).toContain('quick count the files in src');
    expect(viewer).not.toContain('Message JamCLI');
    // A line typed to the child shows in its transcript and reaches it with its next step.
    await setup.mockInput.typeText('count css too');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('You said: count css too'));
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => frame.includes('Message JamCLI') && !frame.includes('Esc back'));
    // Once it ends, the board keeps it for a while with how it ended and what it cost.
    const done = await frameWith(setup, (frame) => frame.includes('The child counted twelve.') && frame.includes('● quick count the files in src'));
    expect(done).toMatch(/● quick count the files in src · \d+s · 320 tokens/);
    expect(done).toContain('· ok');
    const heard = context.server.completions().map((request) => JSON.stringify(request.body));
    expect(heard.some((body) => body.includes('[The person watching says:\\ncount css too]'))).toBe(true);
  } finally {
    await close();
  }
}, 30_000);

test('Down lands on the running child past the ended ones, and two Downs arriving together move two rows', async () => {
  const { setup, runtime, close } = await open({ allowTools: ['task'] }, { size });
  try {
    // One child ends at once; two more run long enough to walk between them.
    context.server.enqueue(
      { toolCalls: [{ id: 't1', name: 'task', arguments: { agent: 'quick', prompt: 'first, quick' } }] },
      { text: 'Done first.' },
      {
        toolCalls: [
          { id: 't2', name: 'task', arguments: { agent: 'quick', prompt: 'second, slow', background: true } },
          { id: 't3', name: 'task', arguments: { agent: 'quick', prompt: 'third, slow', background: true } },
        ],
      },
      // The two children and the parent's last request race for these, so all three are slow and none is told apart.
      { text: 'Done.', delayMs: 4_000 },
      { text: 'Done.', delayMs: 4_000 },
      { text: 'Done.', delayMs: 4_000 }
    );
    await setup.mockInput.typeText('delegate it');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('● quick first, quick') && frame.includes('◐ quick second, slow') && frame.includes('◐ quick third, slow'));
    setup.mockInput.pressArrow('down');
    const first = await frameWith(setup, (frame) => frame.includes('· Enter looks in'));
    expect(first).toMatch(/◐ quick second, slow .* Enter looks in/);
    // Two presses in one burst: the second reads the choice the first made.
    setup.mockInput.pressArrow('up');
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressArrow('down');
    const third = await frameWith(setup, (frame) => /◐ quick third, slow .* Enter looks in/.test(frame));
    expect(third).not.toMatch(/second, slow .* Enter looks in/);
    for (const item of runtime.work()) runtime.stopWork(item.id);
  } finally {
    await close();
  }
}, 30_000);

test('a child that ended leaves the board once the person sends another message, and the board goes with it', async () => {
  const { setup, close } = await open({ allowTools: ['task'] }, { size });
  try {
    context.server.enqueue(
      { toolCalls: [{ id: 't1', name: 'task', arguments: { agent: 'quick', prompt: 'judge the jokes' } }] },
      { text: 'The SQL one wins.' },
      { text: 'The child picked the SQL joke.' },
      { text: 'Glad you liked it.' }
    );
    await setup.mockInput.typeText('delegate it');
    setup.mockInput.pressEnter();
    // Ended in this turn, the child stays on the board with how it ended.
    const ended = await frameWith(setup, (frame) => frame.includes('The child picked the SQL joke.') && frame.includes('● quick judge the jokes'));
    expect(ended).toContain('Agents 1 done');
    await setup.mockInput.typeText('thanks');
    setup.mockInput.pressEnter();
    // The next message puts it behind the person: its row, the header, and the empty board all go.
    const after = await frameWith(setup, (frame) => frame.includes('Glad you liked it.') && !frame.includes('● quick judge the jokes'));
    expect(after).not.toContain('Agents');
    expect(after).not.toContain('No checklist yet');
  } finally {
    await close();
  }
}, 30_000);

/** Move the clock the board reads forward, as if that long had passed, and back when the test ends. */
function wind(ms: number) {
  const real = Date.now.bind(Date);
  const spy = spyOn(Date, 'now').mockImplementation(() => real() + ms);
  return () => spy.mockRestore();
}
const EXPIRES = 95_000;

test('an ended child leaves the board when its minute and a half is up, with motion reduced too, and cannot be chosen after', async () => {
  const { setup, close } = await open({ allowTools: ['task'] }, { size, reducedMotion: true });
  let unwind = () => undefined as void;
  try {
    context.server.enqueue({ toolCalls: [{ id: 't1', name: 'task', arguments: { agent: 'quick', prompt: 'judge the jokes' } }] }, { text: 'The SQL one wins.' }, { text: 'The child picked the SQL joke.' });
    await setup.mockInput.typeText('delegate it');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('The child picked the SQL joke.') && frame.includes('● quick judge the jokes'));
    unwind = wind(EXPIRES);
    // The clock behind the board keeps going without motion: nothing is animated by it.
    await frameWith(setup, (frame) => !frame.includes('● quick judge the jokes'), 5_000);
    setup.mockInput.pressArrow('down');
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain('Enter looks in');
  } finally {
    unwind();
    await close();
  }
}, 30_000);

test('a choice held on a child that has left the board is let go, so Enter does not open it', async () => {
  const { setup, runtime, close } = await open({ allowTools: ['task'] }, { size });
  let unwind = () => undefined as void;
  try {
    context.server.enqueue(
      { toolCalls: [{ id: 't1', name: 'task', arguments: { agent: 'quick', prompt: 'first, quick' } }] },
      { text: 'Done first.' },
      { toolCalls: [{ id: 't2', name: 'task', arguments: { agent: 'quick', prompt: 'second, slow', background: true } }] },
      { text: 'Done.', delayMs: 8_000 },
      { text: 'Done.', delayMs: 8_000 }
    );
    await setup.mockInput.typeText('delegate it');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('● quick first, quick') && frame.includes('◐ quick second, slow'));
    // Down lands on the running child; Up moves the choice to the ended one.
    setup.mockInput.pressArrow('down');
    await frameWith(setup, (frame) => /◐ quick second, slow .* Enter looks in/.test(frame));
    setup.mockInput.pressArrow('up');
    await frameWith(setup, (frame) => /● quick first, quick .* Enter looks in/.test(frame));
    // Its minute and a half goes by while the other still runs.
    unwind = wind(EXPIRES);
    await frameWith(setup, (frame) => !frame.includes('● quick first, quick') && frame.includes('◐ quick second, slow'), 5_000);
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await Bun.sleep(100);
    await setup.renderOnce();
    // Nothing was opened: the composer is still the composer.
    expect(setup.captureCharFrame()).toContain('Message JamCLI');
    for (const item of runtime.work()) runtime.stopWork(item.id);
  } finally {
    unwind();
    await close();
  }
}, 40_000);

test('the header names the keys whenever a child can be chosen, running or ended', async () => {
  const { setup, close } = await open({ allowTools: ['task'] }, { size });
  try {
    context.server.enqueue({ toolCalls: [{ id: 't1', name: 'task', arguments: { agent: 'quick', prompt: 'judge the jokes' } }] }, { text: 'The SQL one wins.' }, { text: 'The child picked the SQL joke.' });
    await setup.mockInput.typeText('delegate it');
    setup.mockInput.pressEnter();
    const ended = await frameWith(setup, (frame) => frame.includes('The child picked the SQL joke.') && frame.includes('Agents 1 done'));
    expect(ended).toContain('↓ choose an agent, Enter looks in');
  } finally {
    await close();
  }
}, 30_000);

/** One child that has ended, on the board, after a message the person sent. */
async function endedChild(setup: any) {
  context.server.enqueue({ toolCalls: [{ id: 't1', name: 'task', arguments: { agent: 'quick', prompt: 'judge the jokes' } }] }, { text: 'The SQL one wins.' }, { text: 'The child picked the SQL joke.' });
  await setup.mockInput.typeText('delegate it');
  setup.mockInput.pressEnter();
  await frameWith(setup, (frame) => frame.includes('The child picked the SQL joke.') && frame.includes('Agents 1 done') && frame.includes('ready'));
}
const composerRow = (frame: string) => frame.split('\n').find((row) => /^│ (delegate it|Message JamCLI)/.test(row)) ?? '';

test('Up from the first child lets go of the choice, and the next Up recalls the last prompt', async () => {
  const { setup, close } = await open({ allowTools: ['task'] }, { size });
  try {
    await endedChild(setup);
    setup.mockInput.pressArrow('down');
    await frameWith(setup, (frame) => /● quick judge the jokes .* Enter looks in/.test(frame));
    setup.mockInput.pressArrow('up');
    const released = await frameWith(setup, (frame) => frame.includes('↓ choose an agent') && !/judge the jokes .* Enter looks in/.test(frame));
    expect(composerRow(released)).toContain('Message JamCLI');
    setup.mockInput.pressArrow('up');
    const recalled = await frameWith(setup, (frame) => frame.includes('history 1/1'));
    expect(composerRow(recalled)).toContain('delegate it');
  } finally {
    await close();
  }
}, 30_000);

test('Escape lets go of the choice between turns, and Enter looks in on the chosen child', async () => {
  const { setup, close } = await open({ allowTools: ['task'] }, { size });
  try {
    await endedChild(setup);
    setup.mockInput.pressArrow('down');
    await frameWith(setup, (frame) => /● quick judge the jokes .* Enter looks in/.test(frame));
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => frame.includes('↓ choose an agent') && !/judge the jokes .* Enter looks in/.test(frame));
    // Chosen again, Enter opens its run in place of the conversation.
    setup.mockInput.pressArrow('down');
    await frameWith(setup, (frame) => /judge the jokes .* Enter looks in/.test(frame));
    setup.mockInput.pressEnter();
    const opened = await frameWith(setup, (frame) => !frame.includes('Message JamCLI') && frame.includes('judge the jokes'));
    expect(opened).not.toContain('history ');
  } finally {
    await close();
  }
}, 30_000);

test('with a message queued, Down takes it back and does not choose a child', async () => {
  const { setup, runtime, close } = await open({ allowTools: ['task'] }, { size });
  try {
    context.server.enqueue(
      { toolCalls: [{ id: 't1', name: 'task', arguments: { agent: 'quick', prompt: 'count the files in src' } }] },
      { toolCalls: [{ id: 'g1', name: 'glob', arguments: { pattern: '*.ts' } }], delayMs: 2_500 },
      { text: 'Twelve.' },
      { text: 'The child counted twelve.' }
    );
    await setup.mockInput.typeText('delegate it');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('◐ quick count the files in src'));
    await setup.mockInput.typeText('and then this');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('queued, ↓ edit'));
    setup.mockInput.pressArrow('down');
    const back = await frameWith(setup, (frame) => !frame.includes('queued, ↓ edit') && /│ and then this/.test(frame));
    expect(back).not.toMatch(/count the files in src .* Enter looks in/);
    for (const item of runtime.work()) runtime.stopWork(item.id);
  } finally {
    await close();
  }
}, 30_000);
