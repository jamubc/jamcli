import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness } from './harness.js';

const { context, open } = interfaceHarness();
const FIXTURE = path.join(import.meta.dir, '../../../testing/modernMcpServer.ts');
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };

test('an MCP prompt runs as /server:prompt, and @ completes a resource the turn then includes', async () => {
  fs.mkdirSync(path.join(context.root, '.jamcli'), { recursive: true });
  fs.writeFileSync(path.join(context.root, '.jamcli', 'mcp.json'), JSON.stringify({ servers: [{ id: 'modern', command: 'bun', args: [FIXTURE], enabled: true }] }));
  context.server.enqueue({ text: 'Reviewed.' }, { text: 'Summarized.' });
  const { setup, close } = await open({ mcp: undefined, env }, { size: { width: 110, height: 40 } });
  try {
    await setup.mockInput.typeText('/modern:re');
    expect(await frameWith(setup, (frame) => frame.includes('/modern:review'), 10_000)).toMatch(/\/modern:review <file> \[focus\]/);
    await setup.mockInput.typeText('view a.ts');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Reviewed.'), 10_000);
    expect(context.server.completions().at(-1)!.body.messages.at(-1).content).toBe('Review a.ts.');

    await setup.mockInput.typeText('summarize @docs');
    await frameWith(setup, (frame) => frame.includes('modern:docs://readme'), 5_000);
    setup.mockInput.pressTab();
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Summarized.'), 10_000);
    const sent = context.server.completions().at(-1)!.body.messages.at(-1).content;
    expect(sent).toStartWith('summarize @modern:docs://readme');
    expect(sent).toContain('README: build with bun.');
  } finally {
    await close();
  }
}, 30_000);
