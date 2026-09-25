import { Readable, Writable } from 'node:stream';
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

/**
 * A minimal ACP agent on the official SDK, used only by the AcpClient tests. It streams
 * one message chunk, asks for permission, then a second chunk naming the decision.
 */
const SESSION_ID = 'fake-session';

const stream = ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>);
new AgentSideConnection(
  (client) => ({
    initialize: async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: 'fake-agent', version: '0.0.1' },
      agentCapabilities: {},
      authMethods: [],
      // For tests: the environment variable names this agent was started with.
      _meta: { envNames: Object.keys(process.env) },
    }),
    authenticate: async () => ({}),
    newSession: async () => ({
      sessionId: SESSION_ID,
      configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'fake-model', options: [{ value: 'fake-model', name: 'fake-model' }] }],
    }),
    prompt: async (params) => {
      await client.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'pong ' } } });
      const answer = await client.requestPermission({
        sessionId: params.sessionId,
        toolCall: { toolCallId: 'call-1', title: 'write_file', kind: 'edit', status: 'pending' },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
        ],
      });
      const allowed = answer.outcome.outcome === 'selected' && answer.outcome.optionId === 'allow-once';
      await client.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: allowed ? 'allowed' : 'denied' } } });
      return { stopReason: 'end_turn' };
    },
    cancel: async () => {},
  }),
  stream
);
