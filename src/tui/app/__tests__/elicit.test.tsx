import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness, type Setup } from './harness.js';

const { context, open } = interfaceHarness();
const FIXTURE = path.join(import.meta.dir, '../../../testing/modernMcpServer.ts');

async function send(setup: Setup, line: string): Promise<void> {
  await setup.mockInput.typeText(line);
  setup.mockInput.pressEnter();
}

function withServer() {
  fs.mkdirSync(path.join(context.root, '.jamcli'), { recursive: true });
  fs.writeFileSync(path.join(context.root, '.jamcli', 'mcp.json'), JSON.stringify({ servers: [{ id: 'modern', command: 'bun', args: [FIXTURE], enabled: true }] }));
}

test('an MCP server\'s form is asked field by field, confirmed, and sent', async () => {
  withServer();
  context.server.enqueue({ toolCalls: [{ id: 'd1', name: 'modern__deploy', arguments: {} }] }, { text: 'Deployed.' });
  const { setup, close } = await open({ mcp: undefined, allowTools: ['modern__deploy'] }, { size: { width: 110, height: 40 } });
  try {
    await send(setup, 'deploy it');
    const first = await frameWith(setup, (frame) => frame.includes('modern asks: env'), 20_000);
    expect(first).toContain('Deploy where?');
    expect(first).toContain('staging');
    expect(first).toContain('production');
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressEnter();
    const second = await frameWith(setup, (frame) => frame.includes('modern asks: confirm (optional)'));
    expect(second).toContain('Leave it out');
    setup.mockInput.pressEnter();
    const confirm = await frameWith(setup, (frame) => frame.includes('Send these answers to modern?'));
    expect(confirm).toContain('env: production');
    expect(confirm).toContain('confirm: true');
    setup.mockInput.pressEnter();
    const done = await frameWith(setup, (frame) => frame.includes('Deployed.'), 20_000);
    expect(done).toContain('Sent modern what it asked for.');
    const tool = context.server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool');
    expect(tool.content).toBe('deployed to production, confirmed');
  } finally {
    await close();
  }
}, 60_000);

test('Escape cancels, and the server hears so', async () => {
  withServer();
  context.server.enqueue({ toolCalls: [{ id: 'd1', name: 'modern__deploy', arguments: {} }] }, { text: 'Not deployed.' });
  const { setup, close } = await open({ mcp: undefined, allowTools: ['modern__deploy'] }, { size: { width: 110, height: 40 } });
  try {
    await send(setup, 'deploy it');
    await frameWith(setup, (frame) => frame.includes('modern asks: env'), 20_000);
    setup.mockInput.pressEscape();
    const done = await frameWith(setup, (frame) => frame.includes('Not deployed.'), 20_000);
    expect(done).toContain('Cancelled what modern asked for.');
    const tool = context.server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool');
    expect(tool.content).toBe('not deployed: cancel');
  } finally {
    await close();
  }
}, 60_000);
