import { expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import * as configCli from '../../cli/config.js';
import { hostFixture, said } from './fixture.js';

const { context, open } = hostFixture();

test('/steer queues steering instructions on the runtime', async () => {
  const { host, runtime, entries } = await open();
  await host.run('/steer use bash tools to run the test');
  expect(said(entries)).toContain('Steering instruction queued for the next turn.');

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

test('/agentic lists each setting, off by default', async () => {
  const { host, entries } = await open();
  await host.run('/agentic');
  const text = said(entries);
  expect(text).toContain('Steering and guards:');
  expect(text).toContain('tool_use_enforcement: off (default)');
  expect(text).toContain('stall_guards: off (default)');
  expect(text).toContain('neither writes to the project');
});

test('/agentic on saves into the user configuration and writes nothing to the project', async () => {
  const { host, entries } = await open();
  await host.run('/agentic on');

  expect(said(entries)).toContain('Autonomy is on');
  expect(fs.readdirSync(context.root).filter((name) => name === '.jamcli')).toEqual([]);
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json'), 'utf8')) as any;
  expect(saved.agent_loop).toEqual({
    tool_use_enforcement: 'on',
    execution_guidance: 'on',
    intent_ack_continuation: 'on',
    stall_guards: true,
    tool_loop_guardrails: true,
  });

  entries.length = 0;
  await host.run('/agentic');
  expect(said(entries)).toContain('stall_guards: on');
  expect(said(entries)).toContain('tool_loop_guardrails: on');
  expect(said(entries)).not.toMatch(/: (true|false) /);
  expect(said(entries)).not.toContain('stall_guards: off (default)');
  expect(said(entries)).not.toContain('guards off');
});

test('/agentic off returns every setting to off', async () => {
  const { host, entries } = await open();
  await host.run('/agentic on');
  entries.length = 0;
  await host.run('/agentic off');
  expect(said(entries)).toContain('Autonomy is off');
});

test('/agentic on is not a warning when another layer sets the same keys', async () => {
  const { host, entries } = await open();
  // The project sets the same five keys, so every write reports that .jamcli/config.json
  // takes precedence. That is an advisory on a successful write, not a failure.
  fs.mkdirSync(path.join(context.root, '.jamcli'), { recursive: true });
  fs.writeFileSync(
    path.join(context.root, '.jamcli', 'config.json'),
    JSON.stringify({
      agent_loop: {
        tool_use_enforcement: 'off',
        execution_guidance: 'off',
        intent_ack_continuation: 'off',
        stall_guards: false,
        tool_loop_guardrails: false,
      },
    }),
  );

  await host.run('/agentic on');

  const text = said(entries);
  expect(text).toContain('Autonomy is on');
  expect(text).not.toContain('except these');
  expect(text).not.toContain('could not be saved');
  expect(text).not.toContain('takes precedence');
});

test('/agentic names a setting it could not save and keeps the rest', async () => {
  const { host, entries } = await open();
  const file = path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json');
  // A user configuration that will not parse refuses every write, and each one is named.
  fs.writeFileSync(file, '{ not json', 'utf8');

  await host.run('/agentic on');

  const text = said(entries);
  expect(text).toContain('Autonomy is on');
  expect(text).toContain('except these, which were not saved:');
  for (const key of ['tool_use_enforcement', 'execution_guidance', 'intent_ack_continuation', 'stall_guards', 'tool_loop_guardrails']) {
    expect(text).toContain(`agent_loop.${key}`);
  }
});

test('/agentic names the one setting the store refused, and saves the other four', async () => {
  const real = configCli.runConfigCommand;
  const store = spyOn(configCli, 'runConfigCommand').mockImplementation(async (request, root, io) =>
    request.args[0] === 'agent_loop.execution_guidance' ? 1 : real(request, root, io)
  );
  try {
    const { host, entries } = await open();
    await host.run('/agentic on');

    const saved = JSON.parse(fs.readFileSync(path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json'), 'utf8')) as any;
    expect(saved.agent_loop).toEqual({ tool_use_enforcement: 'on', intent_ack_continuation: 'on', stall_guards: true, tool_loop_guardrails: true });
    const text = said(entries);
    expect(text).toContain('except these, which were not saved:\n  agent_loop.execution_guidance');
    for (const key of ['tool_use_enforcement', 'intent_ack_continuation', 'stall_guards', 'tool_loop_guardrails']) {
      expect(text).not.toContain(`agent_loop.${key}`);
    }
  } finally {
    store.mockRestore();
  }
});

test('/agentic says nothing about permission modes, and rejects an unknown argument', async () => {
  const { host, entries } = await open();
  await host.run('/agentic on');
  expect(said(entries)).not.toContain('/mode auto');

  entries.length = 0;
  await host.run('/agentic maybe');
  expect(said(entries)).toContain('/agentic takes on or off, not maybe');
});
