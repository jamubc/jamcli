import { expect, test } from 'bun:test';
import { hostFixture, said } from './fixture.js';

const { open } = hostFixture();

test('/steer queues steering instructions on the runtime', async () => {
  const { host, runtime, entries } = await open();
  await host.run('/steer use bash tools to run the test');
  expect(said(entries)).toContain('Steering instruction queued');

  // Verify that next turn receives the steering instruction
  const runPrompt = await runtime.run('check progress');
  expect(runPrompt.session?.messages.some((m) => m.content.includes('use bash tools to run the test'))).toBe(true);
});

test('/goal sets, inspects, and clears standing goals', async () => {
  const { host, runtime, entries } = await open();
  await host.run('/goal fix all TypeScript typecheck errors');
  expect(runtime.getGoal()).toBe('fix all TypeScript typecheck errors');

  entries.length = 0;
  await host.run('/goal');
  expect(said(entries)).toContain('Standing goal: fix all TypeScript typecheck errors');

  entries.length = 0;
  await host.run('/goal clear');
  expect(runtime.getGoal()).toBeUndefined();
  expect(said(entries)).toContain('Standing goal cleared');
});

test('/agentic displays status and toggles settings', async () => {
  const { host, entries } = await open();
  await host.run('/agentic status');
  expect(said(entries)).toContain('Agentic stack status:');
  expect(said(entries)).toContain('Tool use enforcement:');
  expect(said(entries)).toContain('Stall guards:');

  entries.length = 0;
  await host.run('/agentic on');
  expect(said(entries)).toContain('Agentic mode enabled');
});
