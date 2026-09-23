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
