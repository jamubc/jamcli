import { expect, test } from 'bun:test';
import { customCommandTurn } from '../commandTurn.js';
import type { Runtime } from '../../runtime/index.js';

/** A runtime whose only prompt is modern:review, with a required file argument. */
const configured = {
  mcpPrompts: async () => [{ serverId: 'modern', name: 'review', arguments: [{ name: 'file', required: true }] }],
  mcpPrompt: async (_serverId: string, _name: string, args: Record<string, string>) => `Review ${args.file}.`,
} as unknown as Runtime;

test('a /server:prompt matches its name without case and labels the turn', async () => {
  const { prompt, turn } = await customCommandTurn('/MODERN:Review a.ts', process.cwd(), configured);
  expect(prompt).toBe('Review a.ts.');
  expect(turn).toEqual({ label: '/MODERN:Review' });
});

test('a prompt missing a required argument throws before anything is sent', async () => {
  await expect(customCommandTurn('/modern:review', process.cwd(), configured)).rejects.toThrow('/modern:review needs file.');
});

test('a path that is not a prompt is sent as written, with servers configured', async () => {
  const { prompt, turn } = await customCommandTurn('/tmp/x', process.cwd(), configured);
  expect(prompt).toBe('/tmp/x');
  expect(turn).toEqual({});
});
