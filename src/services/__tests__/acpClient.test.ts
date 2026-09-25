import { test, expect } from 'bun:test';
import path from 'node:path';
import { AcpClient, delegateToAgent, normalizeAgentsFile } from '../AcpClient.js';

const fixture = path.resolve(import.meta.dirname, '../../acp/__tests__/fakeAgent.ts');

test('the ACP client initializes, opens a session, streams a prompt, and answers a permission request', async () => {
  const client = new AcpClient({ command: process.execPath, args: [fixture] });
  const init = await client.start();
  expect(init.protocolVersion).toBe(1);
  expect(init.agentInfo?.name).toBe('fake-agent');

  const session = await client.newSession(process.cwd());
  expect(session.sessionId).toBe('fake-session');
  expect(session.configOptions[0]).toMatchObject({ id: 'model', currentValue: 'fake-model' });

  const updates: any[] = [];
  let permissionSeen = false;
  const result = await client.prompt(session.sessionId, 'ping', {
    onUpdate: (update) => updates.push(update),
    onPermission: (request) => {
      permissionSeen = true;
      expect(request.options).toHaveLength(2);
      expect(request.toolCall.toolCallId).toBe('call-1');
      return { outcome: 'selected', optionId: 'allow-once' };
    },
  });

  expect(result.stopReason).toBe('end_turn');
  expect(permissionSeen).toBe(true);
  expect(updates.filter((update) => update.sessionUpdate === 'agent_message_chunk').map((update) => update.content.text)).toEqual([
    'pong ',
    'allowed',
  ]);

  await client.stop();
});

test('the ACP client denies a permission request when no policy callback is supplied', async () => {
  const client = new AcpClient({ command: process.execPath, args: [fixture] });
  await client.start();
  const session = await client.newSession(process.cwd());

  const updates: any[] = [];
  const result = await client.prompt(session.sessionId, 'ping', { onUpdate: (update) => updates.push(update) });

  expect(result.stopReason).toBe('end_turn');
  expect(updates.filter((update) => update.sessionUpdate === 'agent_message_chunk').map((update) => update.content.text)).toEqual([
    'pong ',
    'denied',
  ]);

  await client.stop();
});

test('delegateToAgent runs one prompt and returns the streamed response', async () => {
  const result = await delegateToAgent(
    { command: process.execPath, args: [fixture], name: 'fake' },
    'ping',
    { onPermission: () => ({ outcome: 'selected', optionId: 'allow-once' }) }
  );

  expect(result.agent).toBe('fake');
  expect(result.sessionId).toBe('fake-session');
  expect(result.response).toBe('pong allowed');
  expect(result.stopReason).toBe('end_turn');
});

test('normalizeAgentsFile accepts a Zed-style agent_servers map', () => {
  const agents = normalizeAgentsFile({ agent_servers: { copilot: { command: 'copilot', args: ['--acp'], env: {} } } });
  expect(agents).toEqual([{ id: 'copilot', command: 'copilot', args: ['--acp'], env: {} }]);
});

test('normalizeAgentsFile accepts an agents array', () => {
  const agents = normalizeAgentsFile({ agents: [{ id: 'a', command: 'agent-a' }] });
  expect(agents).toEqual([{ id: 'a', command: 'agent-a' }]);
});

test('an external agent gets no provider key unless its entry names one', async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-in-the-parent';
  try {
    const plain = new AcpClient({ command: process.execPath, args: [fixture] });
    const names = ((await plain.start()) as any)._meta.envNames as string[];
    await plain.stop();
    expect(names).toContain('PATH');
    expect(names).not.toContain('ANTHROPIC_API_KEY');
    const named = new AcpClient({ command: process.execPath, args: [fixture], env_passthrough: ['ANTHROPIC_API_KEY'] });
    expect(((await named.start()) as any)._meta.envNames).toContain('ANTHROPIC_API_KEY');
    await named.stop();
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});

test('the client offers the agent no file system capabilities', async () => {
  const client = new AcpClient({ command: process.execPath, args: [fixture] });
  const init = await client.start();
  expect((init as any)._meta.clientCapabilities.fs).toEqual({ readTextFile: false, writeTextFile: false });
  await client.stop();
});

test('killing the agent mid-prompt fails the prompt cleanly', async () => {
  const previous = process.env.FAKE_AGENT_HANG;
  process.env.FAKE_AGENT_HANG = '1';
  try {
    const client = new AcpClient({ command: process.execPath, args: [fixture] });
    await client.start();
    const session = await client.newSession(process.cwd());
    let started = false;
    const settled = client.prompt(session.sessionId, 'ping', { timeoutMs: 3_000, onUpdate: () => (started = true) }).then(
      () => 'resolved',
      (reason: any) => String(reason?.message ?? reason)
    );
    // Wait until the prompt is really in flight, then kill the agent under it.
    const deadline = Date.now() + 5_000;
    while (!started && Date.now() < deadline) await Bun.sleep(20);
    expect(started).toBe(true);
    await client.stop();
    expect(await settled).toMatch(/closed|exited/i);
  } finally {
    if (previous === undefined) delete process.env.FAKE_AGENT_HANG;
    else process.env.FAKE_AGENT_HANG = previous;
  }
}, 20_000);

test('an agent that exits while its pipe stays open still fails the prompt', async () => {
  const previous = process.env.FAKE_AGENT_EXIT_KEEP_PIPE;
  process.env.FAKE_AGENT_EXIT_KEEP_PIPE = '1';
  try {
    const client = new AcpClient({ command: process.execPath, args: [fixture] });
    await client.start();
    const session = await client.newSession(process.cwd());
    const settled = client.prompt(session.sessionId, 'ping', { timeoutMs: 2_000 }).then(
      () => 'resolved',
      (reason: any) => String(reason?.message ?? reason)
    );
    expect(await settled).toMatch(/exited/i);
  } finally {
    if (previous === undefined) delete process.env.FAKE_AGENT_EXIT_KEEP_PIPE;
    else process.env.FAKE_AGENT_EXIT_KEEP_PIPE = previous;
  }
}, 20_000);
