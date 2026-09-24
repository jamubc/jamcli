import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness } from './harness.js';

const { context, open } = interfaceHarness();
const command = (id: string, text: string) => ({ toolCalls: [{ id, name: 'run_command', arguments: { command: text } }] });

test('2 allows the chosen pattern for the session, so the same call no longer asks', async () => {
  const { runtime, setup, close } = await open();
  try {
    context.server.enqueue(command('c1', 'echo first'), command('c2', 'echo second'), { text: 'Both ran.' });
    await setup.mockInput.typeText('echo twice');
    setup.mockInput.pressEnter();
    const prompt = await frameWith(setup, (value) => value.includes('Allow run_command echo first?'));
    expect(prompt).toContain('1 allow once');
    expect(prompt).toContain('2 allow run_command(echo first) for this session (1 of 3; Up and Down choose)');
    expect(prompt).toContain('4 deny, and say why');
    // Down walks to broader patterns and stops at the last; Up walks back. Keys that
    // arrive together each count.
    setup.mockInput.pressArrow('down');
    await frameWith(setup, (value) => value.includes('2 allow run_command(echo first *) for this session (2 of 3'));
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressArrow('down');
    await frameWith(setup, (value) => value.includes('2 allow run_command(echo *) for this session (3 of 3'));
    setup.mockInput.pressArrow('up');
    setup.mockInput.pressArrow('up');
    await frameWith(setup, (value) => value.includes('2 allow run_command(echo first) for this session (1 of 3'));
    // A grant pressed with the moves, before any frame shows them, takes the pattern
    // they chose: the broadest, which also covers the second call, so it runs unasked.
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressKey('2');
    const after = await frameWith(setup, (value) => value.includes('Both ran.'));
    expect(after).toContain('done: run_command echo first');
    expect(after).toContain('done: run_command echo second');
    expect(after).not.toContain('Allow run_command echo second?');
    expect(runtime.permissionMode).toBe('default');
  } finally {
    await close();
  }
}, 20_000);

test('3 allows the pattern for the project, in .jamcli/config.local.json', async () => {
  const { setup, close } = await open();
  try {
    context.server.enqueue(command('c1', 'echo saved'), { text: 'Saved.' });
    await setup.mockInput.typeText('save it');
    setup.mockInput.pressEnter();
    await frameWith(setup, (value) => value.includes('3 allow run_command(echo saved) for this project, saved in .jamcli/config.local.json'));
    setup.mockInput.pressKey('3');
    await frameWith(setup, (value) => value.includes('Saved.'));
    const local = JSON.parse(fs.readFileSync(path.join(context.root, '.jamcli', 'config.local.json'), 'utf8'));
    expect(local.permissions.allow).toEqual(['run_command(echo saved)']);
  } finally {
    await close();
  }
}, 20_000);

test('4 takes feedback, which the model reads, and the turn goes on', async () => {
  const { setup, close } = await open();
  try {
    context.server.enqueue(command('c1', 'rm -rf build'), { text: 'I will use the clean script instead.' });
    await setup.mockInput.typeText('clean up');
    setup.mockInput.pressEnter();
    await frameWith(setup, (value) => value.includes('Allow run_command rm -rf build?'));
    setup.mockInput.pressKey('4');
    await frameWith(setup, (value) => value.includes('Tell the model what to do instead'));
    await setup.mockInput.typeText('use npm run clean');
    setup.mockInput.pressEnter();
    const after = await frameWith(setup, (value) => value.includes('I will use the clean script instead.'));
    expect(after).toContain('denied: run_command rm -rf build');
    const toolMessage = context.server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool');
    expect(toolMessage.content).toBe('Denied by the user, who said: use npm run clean');
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
