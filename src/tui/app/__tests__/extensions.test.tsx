import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness, type Setup } from './harness.js';

const { context, open } = interfaceHarness();
const tall = { width: 110, height: 44 };

async function send(setup: Setup, line: string): Promise<void> {
  await setup.mockInput.typeText(line);
  setup.mockInput.pressEnter();
}

function projectHooks(command: string) {
  fs.mkdirSync(path.join(context.root, '.jamcli'), { recursive: true });
  fs.writeFileSync(path.join(context.root, '.jamcli', 'config.json'), JSON.stringify({ hooks: { pre_tool: [{ command }] } }));
}

test('/skills, /commands, and /hooks show what each extension point holds', async () => {
  const skill = path.join(context.root, '.agents', 'skills', 'review');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: review\ndescription: Review a change.\n---\nbody\n');
  fs.mkdirSync(path.join(context.root, '.jamcli', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(context.root, '.jamcli', 'commands', 'ship.md'), '---\ndescription: Ship it\n---\nShip.\n');
  fs.writeFileSync(path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json'), JSON.stringify({
    ...JSON.parse(fs.readFileSync(path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json'), 'utf8')),
    hooks: { stop: [{ command: 'true' }] },
  }));
  const { setup, close } = await open({}, { size: tall });
  try {
    await send(setup, '/skills');
    await frameWith(setup, (frame) => frame.includes('review (project): Review a change.'));
    await send(setup, '/commands');
    await frameWith(setup, (frame) => frame.includes('/ship (project): Ship it'));
    await send(setup, '/hooks');
    const shown = await frameWith(setup, (frame) => frame.includes('stop: true'));
    expect(shown).toMatch(/config\.json; runs/);
    await send(setup, '/hooks trust');
    await frameWith(setup, (frame) => frame.includes('This project configures no hooks.'));
  } finally {
    await close();
  }
});

test('a project\'s hooks are asked about once at the start, and run only when trusted', async () => {
  const ran = path.join(context.root, 'hook-ran');
  projectHooks(`touch ${ran}`);
  const first = await open({}, { size: tall });
  try {
    const asked = await frameWith(first.setup, (frame) => frame.includes('This project configures hooks. Run them?'));
    expect(asked).toContain(`pre_tool: touch ${ran}`);
    first.setup.mockInput.pressArrow('down');
    first.setup.mockInput.pressEnter();
    await frameWith(first.setup, (frame) => frame.includes('The project\'s hooks stay off. /hooks trust turns them on.'));
    expect(first.current().hooks().projectTrusted).toBe(false);
  } finally {
    await first.close();
  }

  const second = await open({}, { size: tall });
  try {
    await frameWith(second.setup, (frame) => frame.includes('This project configures hooks. Run them?'));
    second.setup.mockInput.pressEnter();
    await frameWith(second.setup, (frame) => frame.includes('Trusted 1 hook; they run from now on.'));
    context.server.enqueue({ toolCalls: [{ id: 'r1', name: 'glob', arguments: { pattern: '*' } }] }, { text: 'Listed.' });
    await send(second.setup, 'list the files');
    await frameWith(second.setup, (frame) => frame.includes('Listed.'));
    expect(fs.existsSync(ran)).toBe(true);
  } finally {
    await second.close();
  }

  // Trusted as they are, they are not asked about again.
  const third = await open({}, { size: tall });
  try {
    await frameWith(third.setup, (frame) => frame.includes('Message JamCLI.'));
    await Bun.sleep(50);
    await third.setup.renderOnce();
    expect(third.setup.captureCharFrame()).not.toContain('Run them?');
  } finally {
    await third.close();
  }
}, 30_000);
