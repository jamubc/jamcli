import { expect, test } from 'bun:test';
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
    expect(board).toContain('↑↓ choose an agent, Enter looks in');
    setup.mockInput.pressArrow('down');
    await frameWith(setup, (frame) => frame.includes('· Enter looks in') && !frame.includes('↑↓ choose an agent'));
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
