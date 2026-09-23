import { decodeMessage, encodeMessage, type JsonRpcMessage } from '../protocol.js';

/**
 * A minimal ACP agent used only by the AcpClient tests. It answers initialize
 * and session/new, streams one message chunk, asks for permission, then asks a
 * second chunk reflecting the decision before completing the prompt.
 */

const SESSION_ID = 'fake-session';

process.stdin.setEncoding('utf8');
let buffer = '';
let pendingPrompt: number | string | null = null;

const send = (message: JsonRpcMessage): void => {
  process.stdout.write(encodeMessage(message));
};

const handle = (line: string): void => {
  const message = decodeMessage(line);
  if (!message) return;

  if ('method' in message && 'id' in message) {
    if (message.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: 'fake-agent', version: '0.0.1' },
          agentCapabilities: {},
          authMethods: [],
        },
      });
      return;
    }
    if (message.method === 'session/new') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          sessionId: SESSION_ID,
          configOptions: [{ id: 'model', name: 'Model', category: 'model', currentValue: 'fake-model' }],
        },
      });
      return;
    }
    if (message.method === 'session/prompt') {
      pendingPrompt = message.id;
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: SESSION_ID, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'pong ' } } },
      });
      send({
        jsonrpc: '2.0',
        id: 900,
        method: 'session/request_permission',
        params: {
          sessionId: SESSION_ID,
          toolCall: { toolCallId: 'call-1', title: 'write_file', kind: 'other', status: 'pending' },
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
          ],
        },
      });
      return;
    }
    return;
  }

  if ('method' in message) return;

  if (message.id === 900 && pendingPrompt !== null) {
    const outcome = (message.result as { outcome?: { outcome?: string; optionId?: string } } | undefined)?.outcome;
    const allowed = outcome?.outcome === 'selected' && outcome?.optionId === 'allow-once';
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: SESSION_ID,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: allowed ? 'allowed' : 'denied' } },
      },
    });
    send({ jsonrpc: '2.0', id: pendingPrompt, result: { stopReason: 'end_turn' } });
    pendingPrompt = null;
  }
};

process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) handle(line);
});
