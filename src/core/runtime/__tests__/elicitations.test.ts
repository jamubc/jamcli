import { expect, test } from 'bun:test';
import { Elicitations } from '../elicit.js';
import type { AgentEvent } from '../../types.js';
import type { ElicitationRequest } from '../../mcp/connect.js';

const request: ElicitationRequest = { mode: 'form', server: 'docs', message: 'Which space?', schema: { properties: {} } };

test('a request reaches the person through a running interface turn, and the stop cancels what still waits', async () => {
  const events: AgentEvent[] = [];
  const elicit = new Elicitations({ canAsk: true, emit: () => (event) => events.push(event) });
  const first = elicit.ask(request);
  const second = elicit.ask(request);
  expect(events.map((event) => event.type === 'elicitation_request' && event.id)).toEqual(['elicit-1', 'elicit-2']);
  (events[0] as Extract<AgentEvent, { type: 'elicitation_request' }>).respond({ action: 'accept', content: { space: 'eng' } });
  expect(await first).toEqual({ action: 'accept', content: { space: 'eng' } });
  elicit.cancelAll();
  expect(await second).toEqual({ action: 'cancel' });
});

test('elsewhere, or between turns, a request is declined, with a notice when a turn can show one', async () => {
  const events: AgentEvent[] = [];
  expect(await new Elicitations({ canAsk: false, emit: () => (event) => events.push(event) }).ask(request)).toEqual({ action: 'decline' });
  expect(events).toEqual([{ type: 'notice', level: 'warn', message: 'MCP server docs asked for input ("Which space?"), which this surface cannot give, so it was declined.' }]);
  expect(await new Elicitations({ canAsk: true, emit: () => undefined }).ask(request)).toEqual({ action: 'decline' });
});
