import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness } from './harness.js';

const { context, open } = interfaceHarness();

test('/workflows run asks for an approval in the picker, and a yes runs what needs it', async () => {
  fs.mkdirSync(path.join(context.root, '.jamcli', 'workflows'), { recursive: true });
  fs.writeFileSync(
    path.join(context.root, '.jamcli', 'workflows', 'gate.yaml'),
    ['name: gate', 'steps:', '  - id: ok', '    approval: { message: "Go on?" }', ''].join('\n')
  );
  const { setup, close } = await open({}, { size: { width: 110, height: 40 } });
  try {
    await setup.mockInput.typeText('/workflows run gate');
    setup.mockInput.pressEnter();
    const asked = await frameWith(setup, (frame) => frame.includes('Go on?') && frame.includes('Yes'), 10_000);
    expect(asked).toContain('No');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('ended: ok'), 15_000);
  } finally {
    await close();
  }
}, 40_000);
