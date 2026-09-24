import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness, type Setup } from './harness.js';

const { context, open } = interfaceHarness();
const tall = { width: 110, height: 44 };

/** Type a line into the composer and send it. */
async function send(setup: Setup, line: string): Promise<void> {
  await setup.mockInput.typeText(line);
  setup.mockInput.pressEnter();
}

/** Send a message and wait for the model's reply. */
async function turn(setup: Setup, message: string, reply: string): Promise<void> {
  context.server.enqueue({ text: reply, usage: { prompt: 120, completion: 8 } });
  await send(setup, message);
  await frameWith(setup, (frame) => frame.includes(reply) && frame.includes('· ready'));
}

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('/ opens the palette: Up and Down choose, Enter runs the choice, Tab completes, and Escape closes it', async () => {
  const { setup, close } = await open({}, { size: tall });
  try {
    await setup.mockInput.typeText('/co');
    const palette = await frameWith(setup, (frame) => frame.includes('> /context'));
    for (const name of ['/cost', '/compact [focus]', '/config', '/copy [o] [count]']) expect(palette).toContain(name);
    expect(palette).not.toContain('/help');
    // A move and Enter arriving together run the command the move chose.
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressEnter();
    const ran = await frameWith(setup, (frame) => frame.includes('No requests yet, so nothing has been spent.'));
    expect(ran).toContain('> /cost');
    expect(ran).not.toContain('Up and Down choose');

    await setup.mockInput.typeText('/he');
    await frameWith(setup, (frame) => frame.includes('> /help'));
    setup.mockInput.pressTab();
    // The name is completed with a space after it, which closes the palette.
    await frameWith(setup, (frame) => /│\/help /.test(frame) && !frame.includes('Up and Down choose'));
    setup.mockInput.pressEnter();
    // Help is an overlay: the commands, and the keys.
    const help = await frameWith(setup, (frame) => frame.includes('Keys: Enter sends'));
    expect(help).toContain('/permissions');
    expect(help).toContain('Filter:');
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => !frame.includes('Keys: Enter sends'));

    // Up and Down belong to the palette while it is open: the cursor stays where it was.
    await setup.mockInput.typeText('/cop');
    await frameWith(setup, (frame) => frame.includes('> /copy'));
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressArrow('up');
    await setup.mockInput.typeText('y');
    await frameWith(setup, (frame) => /│\/copy +│/.test(frame));
    setup.mockInput.pressEscape();
    for (let index = 0; index < 5; index += 1) setup.mockInput.pressBackspace();
    await frameWith(setup, (frame) => frame.includes('Message JamCLI.'));

    await setup.mockInput.typeText('/zz');
    await frameWith(setup, (frame) => frame.includes('No command starts with that.'));
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => !frame.includes('No command starts with that.'));
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('/zz is not a command. /help lists them.'));
    await send(setup, '/undo');
    await frameWith(setup, (frame) => frame.includes('/undo is not available yet.'));
    // A slash command never reaches the model.
    expect(context.server.completions()).toHaveLength(0);
  } finally {
    await close();
  }
}, 30_000);

test('/cost, /context, and /model report on the session, and /model switches later turns', async () => {
  const { setup, close } = await open({}, { size: tall });
  try {
    await turn(setup, 'hi there', 'Hello.');
    await send(setup, '/cost');
    const cost = await frameWith(setup, (frame) => frame.includes('This session:'));
    expect(cost).toContain('This session: $0.00 over 1 request.');
    expect(cost).toContain('- ollama:fake-model: $0.00, 1 request, 120 in, 8 out');
    await send(setup, '/context');
    expect(await frameWith(setup, (frame) => frame.includes('> /context') && frame.includes('Compaction starts at'))).toMatch(/Context: [\d,]+ of [\d,]+ tokens a request may use \(\d+%\), over \d+ messages\./);
    await send(setup, '/model info');
    const model = await frameWith(setup, (frame) => frame.includes('Model: ollama:fake-model'));
    expect(model).toMatch(/Context window: [\d,]+ tokens/);
    expect(model).toContain('Switch with /model provider:model');
    await send(setup, '/model ollama:other-model');
    const switched = await frameWith(setup, (frame) => frame.includes('Later turns use ollama:other-model.'));
    expect(switched).toContain('default mode · ollama:other-model');
    await send(setup, '/model anthropic:claude-x');
    await frameWith(setup, (frame) => frame.includes('Not switched:'));
  } finally {
    await close();
  }
}, 30_000);

test('/permissions lists the rules, adds one for the session or a file, and removes it', async () => {
  const { setup, close } = await open({}, { size: tall });
  try {
    await send(setup, '/permissions');
    const listed = await frameWith(setup, (frame) => frame.includes('Mode: default.'));
    expect(listed).toContain('- run_command(cd *)  (built in: built-in)');
    await send(setup, '/permissions allow run_command(echo *) session');
    await frameWith(setup, (frame) => frame.includes('Added: allow run_command(echo *), for this session only. It applies to the next call.'));
    context.server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'echo fine' } }] }, { text: 'Ran it.' });
    await send(setup, 'run echo');
    const ran = await frameWith(setup, (frame) => frame.includes('Ran it.'));
    expect(ran).toContain('done: run_command echo fine');
    expect(ran).not.toContain('Allow run_command');

    await send(setup, '/permissions deny grep');
    await frameWith(setup, (frame) => frame.includes('Added: deny grep, saved in .jamcli/config.local.json.'));
    expect(readJson(path.join(context.root, '.jamcli', 'config.local.json')).permissions.deny).toEqual(['grep']);
    await send(setup, '/permissions remove run_command(echo *)');
    await frameWith(setup, (frame) => frame.includes('Removed allow run_command(echo *) (added in this session).'));
    await send(setup, '/permissions remove run_command(cd *)');
    await frameWith(setup, (frame) => frame.includes('Kept allow run_command(cd *): it is built in.'));
    await send(setup, '/permissions maybe grep');
    await frameWith(setup, (frame) => frame.includes('Remove a rule, wherever it is written'));
  } finally {
    await close();
  }
}, 30_000);

test('/clear starts a new session, /resume lists and reopens the last, and /fork continues in a copy', async () => {
  const { setup, current, close } = await open({}, { size: tall });
  try {
    await turn(setup, 'first question', 'First answer.');
    const first = current().sessionId;
    await send(setup, '/clear');
    const cleared = await frameWith(setup, (frame) => frame.includes(`New session. The last one is ${first}; /resume ${first} opens it again.`));
    const second = current().sessionId;
    expect(second).not.toBe(first);
    expect(cleared).toContain(`session ${second}`);
    expect(cleared).not.toContain('First answer.');

    await send(setup, '/resume list');
    const listed = await frameWith(setup, (frame) => frame.includes('Sessions in this project, latest first:'));
    expect(listed).toContain(`- ${first}: First question, 2 messages, just now`);
    await send(setup, `/resume ${first}`);
    // Replies are Markdown, which can reach the screen a frame after the notice.
    const resumed = await frameWith(setup, (frame) => frame.includes(`Resumed ${first}.`) && frame.includes('First answer.'));
    expect(resumed).toContain(`session ${first}`);
    expect(resumed).toContain('> first question');
    expect(resumed).toContain('First answer.');
    // The session the model sees is the resumed one.
    await turn(setup, 'second question', 'Second answer.');
    expect(context.server.completions().at(-1)!.body.messages.map((message: any) => message.content)).toContain('first question');

    await send(setup, '/fork');
    const forked = await frameWith(setup, (frame) => frame.includes(`Forked ${first} into`) && frame.includes('Second answer.'));
    const copy = current().sessionId;
    expect(copy).not.toBe(first);
    expect(forked).toContain(`session ${copy}`);
    expect(forked).toContain('Second answer.');
    await send(setup, '/resume nope');
    await frameWith(setup, (frame) => frame.includes('No session nope in this project. /resume lists them.'));
  } finally {
    await close();
  }
}, 30_000);

test('commands that change the session wait for a running turn, and the others answer at once', async () => {
  const { setup, close } = await open({}, { size: tall });
  try {
    context.server.enqueue({ text: 'Too slow.', delayMs: 3_000 });
    await send(setup, 'take a while');
    await frameWith(setup, (frame) => frame.includes('thinking · default mode'));
    await send(setup, '/clear');
    await frameWith(setup, (frame) => frame.includes('A turn is running; start a new session when it ends, or press Escape to stop it.'));
    await send(setup, '/cost');
    await frameWith(setup, (frame) => frame.includes('> /cost'));
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => frame.includes('Stopped.'));
  } finally {
    await close();
  }
}, 30_000);

test('/compact says when there is nothing to compact yet', async () => {
  const { setup, close } = await open({}, { size: tall });
  try {
    await send(setup, '/compact');
    await frameWith(setup, (frame) => frame.includes('Nothing to compact yet: the conversation is too short.') && frame.includes('· ready'));
  } finally {
    await close();
  }
}, 30_000);

test('/export writes the session as Markdown and will not overwrite a file; /copy says what it did', async () => {
  const { setup, current, close } = await open({}, { size: tall });
  try {
    await turn(setup, 'export me', 'Exported words.');
    const id = current().sessionId;
    await send(setup, '/export');
    await frameWith(setup, (frame) => frame.includes(`Wrote jamcli-${id}.md.`));
    const written = fs.readFileSync(path.join(context.root, `jamcli-${id}.md`), 'utf8');
    expect(written).toContain('export me');
    expect(written).toContain('Exported words.');
    await send(setup, '/export');
    await frameWith(setup, (frame) => frame.includes(`jamcli-${id}.md exists; name another file.`));
    await send(setup, '/export notes/session.md');
    await frameWith(setup, (frame) => frame.includes('Wrote notes/session.md.'));
    expect(fs.existsSync(path.join(context.root, 'notes', 'session.md'))).toBe(true);

    await send(setup, '/copy o');
    const copied = await frameWith(setup, (frame) => frame.includes('Copied 1 reply') || frame.includes('cannot take text for the clipboard'));
    expect(copied.includes('Copied 1 reply, 15 characters') || copied.includes('so nothing was copied')).toBe(true);
    await send(setup, '/copy x');
    await frameWith(setup, (frame) => frame.includes('Usage: /copy [o] [count]'));
  } finally {
    await close();
  }
}, 30_000);

test('/tools, /mcp, /categories, and /doctor report, and /config reads and changes settings through the same code as jamcli config', async () => {
  const { setup, current, close } = await open({}, { size: tall });
  try {
    await turn(setup, 'hello', 'Hi.');
    await send(setup, '/tools');
    const tools = await frameWith(setup, (frame) => frame.includes('tools offered to the model'));
    expect(tools).toContain('- read_file (read):');
    await send(setup, '/mcp');
    await frameWith(setup, (frame) => frame.includes('No MCP servers configured.'));
    // The CLI's messages name the command as it is typed here.
    await send(setup, '/mcp remove');
    await frameWith(setup, (frame) => frame.includes('Usage: /mcp remove <id>'));
    await send(setup, '/categories');
    await frameWith(setup, (frame) => frame.includes('Model categories (defaults):'));

    await send(setup, '/config get model --show-origin');
    await frameWith(setup, (frame) => frame.includes('ollama:fake-model') && frame.includes('config.json'));
    const before = current();
    await send(setup, '/config set agent_loop.max_steps 7 --scope local');
    await frameWith(setup, (frame) => frame.includes('This session was reopened, so the change applies.'));
    expect(readJson(path.join(context.root, '.jamcli', 'config.local.json')).agent_loop.max_steps).toBe(7);
    expect(current()).not.toBe(before);
    expect(current().sessionId).toBe(before.sessionId);
    await send(setup, '/config provider');
    const providers = await frameWith(setup, (frame) => frame.includes('Providers:'));
    expect(providers).toContain(`- ollama: ${context.server.ollamaBaseUrl}`);
    await send(setup, '/config nonsense');
    await frameWith(setup, (frame) => frame.includes('/config set <key> <value>'));

    await send(setup, '/doctor');
    await frameWith(setup, (frame) => /Everything checked is working\.|\d+ problems?, \d+ warnings?\./.test(frame), 20_000);
  } finally {
    await close();
  }
}, 40_000);

test('/profile lists the profiles, and switches this session to one without writing anything', async () => {
  const profiles = path.join(process.env.JAMCLI_CONFIG_DIR!, 'profiles');
  fs.mkdirSync(profiles);
  fs.writeFileSync(path.join(profiles, 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(profiles, 'terse.json'), JSON.stringify({ name: 'Terse', preferred_model: 'fake-model', system_prompt_override: 'Answer in one word.' }));
  const { setup, close } = await open({}, { size: tall });
  try {
    await send(setup, '/profile');
    const listed = await frameWith(setup, (frame) => frame.includes('Profiles:'));
    expect(listed).toContain('- default (this one)');
    expect(listed).toContain('- terse');
    await send(setup, '/profile terse');
    await frameWith(setup, (frame) => frame.includes('This session now uses the terse profile.'));
    await turn(setup, 'hello', 'Yes.');
    expect(context.server.completions().at(-1)!.body.messages[0].content).toContain('Answer in one word.');
    await send(setup, '/profile');
    await frameWith(setup, (frame) => frame.includes('- terse (this one)'));
    // The choice holds for sessions opened after it.
    await send(setup, '/clear');
    await frameWith(setup, (frame) => frame.includes('New session.'));
    await turn(setup, 'again', 'No.');
    expect(context.server.completions().at(-1)!.body.messages[0].content).toContain('Answer in one word.');
    await send(setup, '/profile missing');
    await frameWith(setup, (frame) => frame.includes('No profile missing. Profiles: default, terse.'));
    expect(fs.existsSync(path.join(context.root, '.jamcli', 'config.local.json'))).toBe(false);
  } finally {
    await close();
  }
}, 30_000);
