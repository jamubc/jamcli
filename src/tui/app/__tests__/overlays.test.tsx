import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness, type Setup } from './harness.js';
import { THEMES } from '../theme.js';

const { context, open } = interfaceHarness({
  models: [
    { id: 'fake-model', contextLength: 32768, capabilities: ['completion', 'tools'] },
    { id: 'other-model', capabilities: ['completion'] },
  ],
});
const tall = { width: 110, height: 40 };

async function send(setup: Setup, line: string): Promise<void> {
  await setup.mockInput.typeText(line);
  setup.mockInput.pressEnter();
}

/** The color a piece of text is drawn in, as #rrggbb. */
function colorOf(setup: Setup, text: string): string | undefined {
  for (const line of setup.captureSpans().lines) {
    const span = line.spans.find((candidate) => candidate.text.includes(text));
    if (span) return `#${[...span.fg.buffer.slice(0, 3)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  return undefined;
}

const userConfig = () => path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json');
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('/model lists what the providers offer with what is known of each, filters as you type, and switches', async () => {
  const config = readJson(userConfig());
  config.api_registry.endpoints = [{ id: 'down', base_url: 'http://127.0.0.1:9/v1' }];
  fs.writeFileSync(userConfig(), JSON.stringify(config));
  const { setup, close } = await open({}, undefined, tall);
  try {
    await send(setup, '/model');
    const listed = await frameWith(setup, (frame) => frame.includes('ollama:other-model') && frame.includes('Not listed: down:'));
    expect(listed).toMatch(/> ollama:fake-model \(in use\)\s+\d+k window · tools · free/);
    expect(listed).toMatch(/ollama:other-model\s+window unknown · free/);
    expect(listed).toContain('Filter: (type to narrow the list)');
    await setup.mockInput.typeText('other');
    const filtered = await frameWith(setup, (frame) => frame.includes('Filter: other') && !frame.includes('ollama:fake-model (in use)'));
    expect(filtered).toContain('(1 of 2)');
    setup.mockInput.pressEnter();
    const switched = await frameWith(setup, (frame) => frame.includes('Later turns use ollama:other-model.'));
    expect(switched).toContain('default mode · ollama:other-model');
    expect(switched).not.toContain('Filter:');
  } finally {
    await close();
  }
}, 30_000);

test('/resume lists the sessions, and Enter opens the chosen one', async () => {
  const { setup, current, close } = await open({}, undefined, tall);
  try {
    context.server.enqueue({ text: 'An answer about parsers.' });
    await send(setup, 'parser question');
    await frameWith(setup, (frame) => frame.includes('An answer about parsers.') && frame.includes('· ready'));
    const first = current().sessionId;
    await send(setup, '/clear');
    await frameWith(setup, (frame) => frame.includes('New session.'));
    await send(setup, '/resume');
    const listed = await frameWith(setup, (frame) => frame.includes('Sessions in this project, latest first'));
    expect(listed).toContain(`> ${first}`);
    expect(listed).toContain('Parser question, 2 messages, just now');
    setup.mockInput.pressEnter();
    const resumed = await frameWith(setup, (frame) => frame.includes(`Resumed ${first}.`) && frame.includes('An answer about parsers.'));
    expect(resumed).toContain(`session ${first}`);
  } finally {
    await close();
  }
}, 30_000);

test('? on an empty composer opens help; Enter puts the chosen command in the composer, and Escape closes it', async () => {
  const { setup, close } = await open({}, undefined, tall);
  try {
    await setup.mockInput.typeText('?');
    const help = await frameWith(setup, (frame) => frame.includes('Keys: Enter sends'));
    expect(help).toMatch(/1 of \d+ · Enter puts the command in the composer/);
    // Typing narrows the list and never reaches the composer.
    await setup.mockInput.typeText('spent');
    await frameWith(setup, (frame) => frame.includes('Filter: spent') && frame.includes('> /cost'));
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => /│\/cost /.test(frame) && !frame.includes('Keys: Enter sends'));
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('No requests yet, so nothing has been spent.'));

    // A ? inside a message is only a character.
    await setup.mockInput.typeText('why?');
    await frameWith(setup, (frame) => /│why\? /.test(frame));
    expect(setup.captureCharFrame()).not.toContain('Keys: Enter sends');
  } finally {
    await close();
  }
}, 30_000);

test('/config lists each setting with its file, and Enter starts a /config set for it', async () => {
  const { setup, close } = await open({}, undefined, tall);
  try {
    await send(setup, '/config');
    const listed = await frameWith(setup, (frame) => frame.includes('Settings, each with the file it comes from'));
    expect(listed).toMatch(/model = "ollama:fake-model"\s+\S*config\.json/);
    await setup.mockInput.typeText('model =');
    await frameWith(setup, (frame) => frame.includes('> model = "ollama:fake-model"'));
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => /│\/config set model /.test(frame));
  } finally {
    await close();
  }
}, 30_000);

test('/theme changes the colors at once and saves the choice for every project', async () => {
  const { setup, close } = await open({}, undefined, tall);
  try {
    await frameWith(setup, (frame) => frame.includes('default mode'));
    const before = colorOf(setup, 'default mode');
    expect(before).toBe(THEMES.dark.dim);
    await send(setup, '/theme');
    const listed = await frameWith(setup, (frame) => frame.includes('Themes'));
    expect(listed).toMatch(/> dark \(in use\)\s+light text on a dark background/);
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Theme: light. It is saved in your user configuration.'));
    const after = colorOf(setup, 'default mode');
    expect(after).toBe(THEMES.light.dim);
    expect(after).not.toBe(before);
    expect(readJson(userConfig()).ui).toEqual({ theme: 'light' });
    // The list opens on the theme in use.
    await send(setup, '/theme');
    await frameWith(setup, (frame) => frame.includes('> light (in use)'));
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => !frame.includes('> light (in use)'));
    await send(setup, '/theme plaid');
    await frameWith(setup, (frame) => frame.includes('plaid is not a theme; choose dark, light, high-contrast, monochrome.'));
  } finally {
    await close();
  }
}, 30_000);

test('the monochrome theme draws every state in the terminal\'s own color', async () => {
  const { setup, close } = await open({}, undefined, tall, THEMES.monochrome);
  try {
    context.server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'echo hi' } }] });
    await send(setup, 'run it');
    await frameWith(setup, (frame) => frame.includes('Allow run_command echo hi?'));
    const plain = colorOf(setup, 'Allow run_command echo hi?');
    expect(colorOf(setup, 'waiting for you')).toBe(plain);
    expect(colorOf(setup, 'asking: run_command echo hi')).toBe(plain);
    expect(plain).not.toBe(THEMES.dark.warn);
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => frame.includes('denied: run_command echo hi'));
  } finally {
    await close();
  }
}, 30_000);
