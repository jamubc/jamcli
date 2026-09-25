import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness } from './harness.js';
import { slashCommandForPrompt } from '../custom.js';
import type { CommandContext } from '../commands.js';

const { context, open } = interfaceHarness();

test('custom commands show their source in the palette, and run as the message they send', async () => {
  const project = path.join(context.root, '.jamcli', 'commands');
  const user = path.join(process.env.JAMCLI_CONFIG_DIR!, 'commands');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(user, { recursive: true });
  fs.writeFileSync(path.join(project, 'review.md'), '---\ndescription: Review a file for bugs\nargument-hint: <file>\nallowed-tools: read_file\n---\nReview $1 for bugs.\n');
  fs.writeFileSync(path.join(user, 'standup.md'), 'Write my standup.\n');
  fs.writeFileSync(path.join(user, 'review.md'), 'The user review, shadowed.\n');
  fs.writeFileSync(path.join(project, 'model.md'), 'Not the built-in.\n');
  context.server.enqueue({ text: 'Looks fine.' });

  const { setup, close } = await open({}, { size: { width: 110, height: 40 } });
  try {
    await frameWith(setup, (frame) => frame.replace(/\s+/g, ' ').includes('/model is a built-in command, which keeps its name'), 2_000);
    await setup.mockInput.typeText('/re');
    const palette = await frameWith(setup, (frame) => frame.includes('Review a file for bugs'));
    expect(palette).toMatch(/\/review <file>\s+Review a file for bugs \(project\)/);
    setup.mockInput.pressBackspace();
    setup.mockInput.pressBackspace();
    await setup.mockInput.typeText('stand');
    expect(await frameWith(setup, (frame) => frame.includes('/standup'))).toMatch(/\/standup\s+Write my standup\. \(user\)/);
    for (let i = 0; i < 6; i += 1) setup.mockInput.pressBackspace();

    await setup.mockInput.typeText('/review src/a.ts');
    setup.mockInput.pressEnter();
    const done = await frameWith(setup, (frame) => frame.includes('Looks fine.'));
    // Shown once, as the message, and not again as a command line.
    expect(done.split('/review src/a.ts').length - 1).toBe(1);
    expect(done).not.toContain('Review src/a.ts for bugs.');
    const sent = context.server.completions().at(-1)!.body;
    expect(sent.messages.at(-1).content).toBe('Review src/a.ts for bugs.');
    expect(sent.tools.map((tool: any) => tool.function.name)).toEqual(['read_file']);
  } finally {
    await close();
  }
}, 20_000);

test('a /server:prompt missing a required argument says what it needs and sends nothing', async () => {
  const notices: string[] = [];
  const sent: string[] = [];
  const command = slashCommandForPrompt({ serverId: 'modern', name: 'review', description: 'Review a file.', arguments: [{ name: 'file', required: true }, { name: 'focus' }] });
  const ctx = {
    running: false,
    notice: (level: string, message: string) => void notices.push(`${level}: ${message}`),
    runtime: {
      mcpPrompt: async () => {
        throw new Error('should not be called');
      },
    },
    send: (text: string) => void sent.push(text),
  } as unknown as CommandContext;
  await command.run(ctx, '');
  expect(notices).toEqual(['warn: /modern:review needs file: /modern:review <file> [focus]']);
  expect(sent).toEqual([]);
});
