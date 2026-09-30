import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness, type Setup } from './harness.js';
import { projectLedger } from '../../../cli/audit.js';

const { context, open } = interfaceHarness();
const command = (id: string, text: string) => ({ toolCalls: [{ id, name: 'run_command', arguments: { command: text } }] });

const PAGE_KEYS = { pageup: '\x1b[5~', pagedown: '\x1b[6~' } as const;

/** Presses a page key until the frame satisfies `done`, rendering between presses. */
async function pageUntil(setup: Setup, key: keyof typeof PAGE_KEYS, done: (frame: string) => boolean): Promise<string> {
  for (let press = 0; press < 20; press += 1) {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    if (done(frame)) return frame;
    setup.mockInput.pressKey(PAGE_KEYS[key]);
    await Bun.sleep(5);
  }
  throw new Error(`${key} never got there.`);
}

test('2 allows the chosen pattern for the session, so the same call no longer asks', async () => {
  const { runtime, setup, close } = await open();
  try {
    context.server.enqueue(command('c1', 'printf first'), command('c2', 'printf second'), { text: 'Both ran.' });
    await setup.mockInput.typeText('printf twice');
    setup.mockInput.pressEnter();
    const prompt = await frameWith(setup, (value) => value.includes('Allow run_command printf first?'));
    expect(prompt).toContain('1  Allow once');
    expect(prompt).toContain('2  Allow this session   run_command(printf first)');
    expect(prompt).toContain('5  Deny with feedback');
    // Down walks to broader patterns and stops at the last; Up walks back. Keys that
    // arrive together each count.
    setup.mockInput.pressArrow('down');
    await frameWith(setup, (value) => value.includes('Allow this session   run_command(printf first *)'));
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressArrow('down');
    await frameWith(setup, (value) => value.includes('Allow this session   run_command(printf *)'));
    setup.mockInput.pressArrow('up');
    setup.mockInput.pressArrow('up');
    await frameWith(setup, (value) => value.includes('Allow this session   run_command(printf first)'));
    // A grant pressed with the moves, before any frame shows them, takes the pattern
    // they chose: the broadest, which also covers the second call, so it runs unasked.
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressKey('2');
    const after = await frameWith(setup, (value) => value.includes('Both ran.'));
    expect(after).toContain('✓ run_command printf first');
    expect(after).toContain('✓ run_command printf second');
    expect(after).not.toContain('Allow run_command printf second?');
    expect(runtime.permissionMode).toBe('default');
  } finally {
    await close();
  }
}, 20_000);

test('3 allows the pattern for the project, in .jamcli/config.local.json', async () => {
  const { setup, close } = await open();
  try {
    context.server.enqueue(command('c1', 'printf saved'), { text: 'Saved.' });
    await setup.mockInput.typeText('save it');
    setup.mockInput.pressEnter();
    // The project row grants the rule the session row shows, so it names it once.
    await frameWith(setup, (value) => value.includes('2  Allow this session   run_command(printf saved)   ▲▼ 1/3') && value.includes('3  Allow this project   the same rule · .jamcli/config.local.json'));
    setup.mockInput.pressKey('3');
    await frameWith(setup, (value) => value.includes('Saved.'));
    const local = JSON.parse(fs.readFileSync(path.join(context.root, '.jamcli', 'config.local.json'), 'utf8'));
    expect(local.permissions.allow).toEqual(['run_command(printf saved)']);
  } finally {
    await close();
  }
}, 20_000);

test('5 takes feedback, which the model reads, and the turn goes on', async () => {
  const { setup, close } = await open();
  try {
    context.server.enqueue(command('c1', 'rm -rf build'), { text: 'I will use the clean script instead.' });
    await setup.mockInput.typeText('clean up');
    setup.mockInput.pressEnter();
    await frameWith(setup, (value) => value.includes('Allow run_command rm -rf build?'));
    setup.mockInput.pressKey('5');
    await frameWith(setup, (value) => value.includes('Feedback for the model'));
    await setup.mockInput.typeText('use npm run clean');
    setup.mockInput.pressEnter();
    const after = await frameWith(setup, (value) => value.includes('I will use the clean script instead.'));
    expect(after).toContain('⊘ run_command rm -rf build');
    const toolMessage = context.server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool');
    expect(toolMessage.content).toBe('Tool call was denied, feedback: use npm run clean');
  } finally {
    await close();
  }
}, 20_000);

test('bypass turns on only when the person types yes, and the status line says so', async () => {
  const { runtime, setup, close } = await open();
  try {
    await setup.mockInput.typeText('/mode bypass');
    setup.mockInput.pressEnter();
    await frameWith(setup, (value) => value.includes('Turn on bypass mode?'));
    await setup.mockInput.typeText('no');
    setup.mockInput.pressEnter();
    await frameWith(setup, (value) => value.includes('Bypass mode was not turned on.'));
    expect(runtime.permissionMode).toBe('default');

    await setup.mockInput.typeText('/mode bypass');
    setup.mockInput.pressEnter();
    await frameWith(setup, (value) => value.includes('Turn on bypass mode?'));
    await setup.mockInput.typeText('yes');
    setup.mockInput.pressEnter();
    const on = await frameWith(setup, (value) => value.includes('BYPASS mode'));
    expect(on).toContain('Bypass mode is on: nothing asks before it runs');
    expect(runtime.permissionMode).toBe('bypass');

    await setup.mockInput.typeText('/mode plan');
    setup.mockInput.pressEnter();
    await frameWith(setup, (value) => value.includes('plan mode ·'));
    await setup.mockInput.typeText('/mode auto');
    setup.mockInput.pressEnter();
    // No sandbox here, so auto mode is refused with the reason.
    await frameWith(setup, (value) => value.includes('Not switched to auto mode: auto mode runs commands without asking only inside a sandbox'));
    expect(runtime.permissionMode).toBe('plan');
  } finally {
    await close();
  }
}, 20_000);

test('4 denies and the turn goes on: the model reads that the call did not run', async () => {
  const { setup, close } = await open();
  try {
    context.server.enqueue(command('c1', 'rm -rf build'), { text: 'Skipped the delete.' });
    await setup.mockInput.typeText('clean up');
    setup.mockInput.pressEnter();
    const prompt = await frameWith(setup, (value) => value.includes('4  Deny, continue'));
    expect(prompt).toContain('[Esc]');
    setup.mockInput.pressKey('4');
    const after = await frameWith(setup, (value) => value.includes('Skipped the delete.'));
    expect(after).toContain('⊘ run_command rm -rf build');
    expect(after).not.toContain('Stopped because a tool call was denied.');
    const toolMessage = context.server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool');
    expect(toolMessage.content).toBe('Tool call was denied.');
  } finally {
    await close();
  }
}, 20_000);

test('the board stays up beside a prompt, and lists what runs beside the turn with how to stop it', async () => {
  const { setup, close } = await open({}, { size: { width: 100, height: 40 } });
  try {
    const todos = [
      { content: 'Start the server', status: 'in_progress', active_form: 'Starting the server', check: 'curl returns 200' },
      { content: 'Take the screenshot', status: 'pending' },
    ];
    context.server.enqueue(
      { toolCalls: [{ id: 't1', name: 'todo_write', arguments: { todos } }] },
      { toolCalls: [{ id: 'b1', name: 'run_command', arguments: { command: 'sleep 20', background: true } }] },
      { text: 'Started.' }
    );
    await setup.mockInput.typeText('serve it');
    setup.mockInput.pressEnter();
    // The prompt says the command stays running; the board is still there above it, with its running step.
    const prompt = await frameWith(setup, (value) => value.includes('Allow run_command sleep 20 · background?'));
    expect(prompt).toContain('in the background');
    expect(prompt).toContain('◐ Starting the server');
    expect(prompt).toContain('│ check: curl returns 200');
    setup.mockInput.pressKey('1');
    // Once it runs, the board lists it, with how long and how to stop it, and the status line counts it.
    const running = await frameWith(setup, (value) => value.includes('/jobs stop job_') && value.includes('Started.'));
    expect(running).toMatch(/◐ command sleep 20 · \d+s · \/jobs stop job_/);
    expect(running).toContain('1 job');
    const id = /\/jobs stop (job_\w+)/.exec(running)![1];
    await setup.mockInput.typeText(`/jobs stop ${id}`);
    setup.mockInput.pressEnter();
    await frameWith(setup, (value) => value.includes(`Stopping ${id}.`));
    await frameWith(setup, (value) => !value.includes('◐ command sleep 20') && !value.includes('1 job'));
  } finally {
    await close();
  }
}, 20_000);

test('the prompt leaves the transcript its rows, and Page Up scrolls it behind the prompt', async () => {
  const { setup, close } = await open({}, { size: { width: 100, height: 30 } });
  try {
    const long = Array.from({ length: 40 }, (_, index) => `printf line-${index + 1}`).join('\n');
    const preamble = Array.from({ length: 12 }, (_, index) => `Step ${index + 1} of the plan.`).join('\n\n');
    context.server.enqueue({ text: preamble, toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: long } }] }, { text: 'Listed.' });
    await setup.mockInput.typeText('list them');
    setup.mockInput.pressEnter();
    // 30 rows: 2 of chrome, 8 kept for the transcript, 10 fixed in the prompt, so 10 lines of the command show, behind the rail.
    const prompt = await frameWith(setup, (value) => value.includes('1  Allow once') && value.includes('Step 10 of the plan.'));
    expect(prompt).toMatch(/^│ │ printf line-10/m);
    expect(prompt).not.toMatch(/^│ │ printf line-11/m);
    expect(prompt).toContain('30 more rows, [↕ scroll]');
    expect(prompt).not.toContain('> list them');
    const paged = await pageUntil(setup, 'pageup', (value) => value.includes('> list them'));
    expect(paged).toContain('1  Allow once');
    await pageUntil(setup, 'pagedown', (value) => !value.includes('> list them') && value.includes('? run_command'));
    setup.mockInput.pressKey('1');
    await frameWith(setup, (value) => value.includes('Listed.'));
  } finally {
    await close();
  }
}, 20_000);

test('an edit prompt shows a short diff whole, and holds a long one to its rows with a note that it goes on', async () => {
  const { setup, close } = await open({}, { size: { width: 100, height: 30 } });
  try {
    fs.writeFileSync(path.join(context.root, 'short.txt'), 'one\ntwo\nthree\n');
    context.server.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'short.txt', find_string: 'two', replace_string: 'TWO' } }] }, { text: 'Changed.' });
    await setup.mockInput.typeText('change the short one');
    setup.mockInput.pressEnter();
    const short = await frameWith(setup, (value) => value.includes('Allow edit short.txt?') && value.includes('TWO'));
    expect(short).not.toContain('the diff continues');
    // Nothing is padded out below the diff: the reason follows its last line.
    const rows = short.split('\n');
    expect(rows.findIndex((row) => row.includes('Default mode asks'))).toBe(rows.findIndex((row) => row.includes('three')) + 1);
    setup.mockInput.pressKey('1');
    await frameWith(setup, (value) => value.includes('Changed.'));

    const before = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n');
    fs.writeFileSync(path.join(context.root, 'long.txt'), `${before}\n`);
    context.server.enqueue({ toolCalls: [{ id: 'e2', name: 'edit', arguments: { path: 'long.txt', find_string: before, replace_string: before.toUpperCase() } }] }, { text: 'Shouted.' });
    await setup.mockInput.typeText('change the long one');
    setup.mockInput.pressEnter();
    const long = await frameWith(setup, (value) => value.includes('Allow edit long.txt?') && value.includes('the diff continues'));
    // 30 rows leave the diff 9, so its first lines show and the rest waits for the wheel.
    expect(long).toContain('- line 1');
    expect(long).not.toContain('LINE 40');
    expect(long).toContain('1  Allow once');
    setup.mockInput.pressKey('1');
    await frameWith(setup, (value) => value.includes('Shouted.'));
  } finally {
    await close();
  }
}, 20_000);

test("a subagent's prompts name it, look in on it, can each be answered, and each goes once it is", async () => {
  const { runtime, setup, close } = await open({ allowTools: ['task'] }, { size: { width: 100, height: 40 } });
  try {
    // Command substitution always asks, so the child asks twice in a row, as in the session that found this.
    context.server.enqueue(
      { toolCalls: [{ id: 't1', name: 'task', arguments: { agent: 'quick', title: 'Count the files', prompt: 'count the files' } }] },
      command('c1', 'printf $(printf one)'),
      command('c2', 'printf $(printf two)'),
      { text: 'Counted.' },
      { text: 'The child counted.' }
    );
    await setup.mockInput.typeText('delegate it');
    setup.mockInput.pressEnter();
    // The heading names the child and its agent before the call, and the reason says only why it asks.
    const first = await frameWith(setup, (value) => value.includes('Count the files · quick › Allow run_command printf $(printf one)?'));
    expect(first).toContain('o look in');
    expect(first).not.toContain('asks, and');
    // o opens the child's view with the prompt still below it; Escape comes back to the same prompt.
    setup.mockInput.pressKey('o');
    await frameWith(setup, (value) => value.includes('type below to talk to it') && value.includes('1  Allow once'));
    setup.mockInput.pressEscape();
    await frameWith(setup, (value) => !value.includes('type below to talk to it') && value.includes('Allow run_command printf $(printf one)?'));
    setup.mockInput.pressKey('1');
    // The answered prompt goes, and the child's next one can be reached and answered.
    await frameWith(setup, (value) => value.includes('Allow run_command printf $(printf two)?') && !value.includes('Allow run_command printf $(printf one)?'));
    setup.mockInput.pressKey('1');
    const done = await frameWith(setup, (value) => value.includes('The child counted.'));
    // Each call the person answered shows what it did, not a run that never ends.
    expect(done).toMatch(/✓ run_command printf \$\(printf one\)/);
    expect(done).toMatch(/✓ run_command printf \$\(printf two\)/);
    // The session that showed the prompts records how the person answered them.
    const log = fs.readFileSync(path.join(context.root, '.jamcli', 'history', `${runtime.sessionId}.jsonl`), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(log.filter((entry) => entry.type === 'approval' && entry.by === 'user').map((entry) => entry.callId)).toEqual(['t1/c1', 't1/c2']);
  } finally {
    await close();
  }
}, 30_000);

test("a grant settles the other children's prompts it now allows, and none is left to answer", async () => {
  const { setup, close } = await open({ allowTools: ['task'] }, { size: { width: 110, height: 44 } });
  try {
    const task = (id: string, letter: string) => ({ id, name: 'task', arguments: { agent: 'quick', title: `Print ${letter}`, prompt: `print ${letter}` } });
    context.server.enqueue(
      { toolCalls: [task('t1', 'a'), task('t2', 'b'), task('t3', 'c')] },
      command('p1', 'printf a'),
      command('p2', 'printf b'),
      command('p3', 'printf c'),
      { text: 'printed' },
      { text: 'printed' },
      { text: 'printed' },
      { text: 'All three printed.' }
    );
    await setup.mockInput.typeText('print three letters');
    setup.mockInput.pressEnter();
    await frameWith(setup, (value) => value.includes('1 of 3 waiting'));
    // The widest pattern the prompt offers covers all three commands; one answer grants it for the session.
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressArrow('down');
    await frameWith(setup, (value) => value.includes('run_command(printf *)'));
    setup.mockInput.pressKey('2');
    const done = await frameWith(setup, (value) => value.includes('All three printed.'));
    expect(done).not.toContain('Allow run_command');
    expect(done.match(/✓ run_command printf [abc]/g)).toHaveLength(3);
  } finally {
    await close();
  }
}, 30_000);

test('ten children asking the same command are one prompt, and one answer for the session leaves none', async () => {
  fs.mkdirSync(path.join(context.root, '.jamcli'), { recursive: true });
  fs.writeFileSync(path.join(context.root, '.jamcli', 'config.json'), JSON.stringify({ delegation: { max_concurrent: 10 } }));
  const { runtime, setup, close } = await open({ allowTools: ['task'] }, { size: { width: 120, height: 60 } });
  try {
    const tasks = Array.from({ length: 10 }, (_, n) => ({ id: `t${n}`, name: 'task', arguments: { agent: 'quick', title: `Check ${n}`, prompt: `check ${n}` } }));
    context.server.enqueue(
      { toolCalls: tasks },
      ...tasks.map((_, n) => command(`p${n}`, 'printf checked')),
      ...tasks.map(() => ({ text: 'checked' })),
      { text: 'All ten checked.' }
    );
    await setup.mockInput.typeText('check ten things');
    setup.mockInput.pressEnter();
    const asked = await frameWith(setup, (value) => value.includes('10 agents ask › Allow run_command printf checked?'));
    // One prompt, however many agents ask: nothing else waits behind it.
    expect(asked).not.toContain('waiting ·');
    // A row under the heading names the agents that ask, in the order they asked.
    expect(asked).toMatch(/│ Check \d · quick {2}Check \d · quick/);
    setup.mockInput.pressKey('2');
    const done = await frameWith(setup, (value) => value.includes('All ten checked.'));
    expect(done).not.toContain('Allow run_command');
    // Each child's call is recorded as answered by the person, once each.
    const log = fs.readFileSync(path.join(context.root, '.jamcli', 'history', `${runtime.sessionId}.jsonl`), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(log.filter((entry) => entry.type === 'approval' && entry.tool === 'run_command' && entry.by === 'user' && entry.allow)).toHaveLength(10);
  } finally {
    await close();
  }
}, 30_000);

test('what a fan-out needs is asked once before it starts, and granted for the session its children run without asking', async () => {
  const { setup, close } = await open({ allowTools: ['task'] }, { size: { width: 110, height: 44 } });
  try {
    const task = (id: string, letter: string) => ({ id, name: 'task', arguments: { agent: 'quick', title: `Print ${letter}`, prompt: `print ${letter}`, needs: ['run_command(printf *)'] } });
    context.server.enqueue(
      { toolCalls: [task('t1', 'a'), task('t2', 'b')] },
      command('p1', 'printf a'),
      command('p2', 'printf b'),
      { text: 'printed' },
      { text: 'printed' },
      { text: 'Both printed.' }
    );
    await setup.mockInput.typeText('print two letters');
    setup.mockInput.pressEnter();
    const asked = await frameWith(setup, (value) => value.includes('Allow what 2 agents about to start will need?'));
    expect(asked).toContain('run_command(printf *)');
    expect(asked).toMatch(/1 {2}Allow for this session/);
    expect(asked).toMatch(/3 {2}Ask as they go/);
    expect(asked).not.toContain('Allow once');
    setup.mockInput.pressKey('1');
    const done = await frameWith(setup, (value) => value.includes('Both printed.'));
    expect(done).not.toContain('Allow run_command');
    // The ledger says, for each child's call, that it was allowed by what was granted before the fan-out started.
    const calls = projectLedger(context.root).filter((entry) => entry.tool === 'run_command');
    expect(calls).toHaveLength(2);
    for (const entry of calls) expect(entry).toMatchObject({ allowed: true, by: 'user', rule: 'run_command(printf *)', source: 'granted before 2 agents started' });
  } finally {
    await close();
  }
}, 30_000);

test('a long command wraps in the prompt, so all of it is read before it is allowed', async () => {
  const { setup, close } = await open({}, { size: { width: 100, height: 40 } });
  try {
    // One line of well over a screen's width, as the child's commands in the session that found this were.
    const long = `printf ${Array.from({ length: 12 }, (_, index) => `part-${index + 1}-of-one-long-line`).join('-')}`;
    context.server.enqueue(command('c1', long), { text: 'Echoed.' });
    await setup.mockInput.typeText('printf it');
    setup.mockInput.pressEnter();
    // Joined back up, the wrapped rows hold the whole command, and nothing says it goes on.
    const whole = (value: string) => value.replace(/[│\s]/g, '').includes(long.replace(/\s/g, ''));
    const prompt = await frameWith(setup, (value) => value.includes('1  Allow once') && whole(value));
    expect(prompt).not.toContain('[↕ scroll]');
    setup.mockInput.pressKey('1');
    await frameWith(setup, (value) => value.includes('Echoed.'));
  } finally {
    await close();
  }
}, 20_000);
