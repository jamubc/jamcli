import { test, expect } from 'bun:test';
import {
  ACP_PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
  isApprovalOutcome,
  permissionOptions,
  stopReasonFor,
  type PermissionOption,
} from '../protocol.js';

test('encode then decode round-trips a request, a notification, and a response', () => {
  const request = {
    jsonrpc: '2.0' as const,
    id: 7,
    method: 'initialize',
    params: { protocolVersion: ACP_PROTOCOL_VERSION },
  };
  expect(decodeMessage(encodeMessage(request))).toEqual(request);

  const notification = { jsonrpc: '2.0' as const, method: 'session/cancel', params: { sessionId: 's1' } };
  expect(decodeMessage(encodeMessage(notification))).toEqual(notification);

  const response = { jsonrpc: '2.0' as const, id: 7, result: { ok: true } };
  expect(decodeMessage(encodeMessage(response))).toEqual(response);
});

test('a session/request_permission message survives the encode and decode path', () => {
  const options = permissionOptions();
  const line = encodeMessage({
    jsonrpc: '2.0',
    id: 11,
    method: 'session/request_permission',
    params: {
      sessionId: 's1',
      toolCall: { toolCallId: 'call-1', title: 'write_file', kind: 'other', status: 'pending' },
      options,
    },
  });

  const decoded = decodeMessage(line) as any;
  expect(decoded).not.toBeNull();
  expect(decoded.method).toBe('session/request_permission');
  expect(decoded.params.sessionId).toBe('s1');
  expect(decoded.params.toolCall.toolCallId).toBe('call-1');
  expect(decoded.params.options).toHaveLength(4);
  expect(decoded.params.options.map((option: PermissionOption) => option.kind)).toEqual([
    'allow_once',
    'allow_always',
    'reject_once',
    'reject_always',
  ]);
});

test('decode rejects lines that are not JSON-RPC 2.0', () => {
  expect(decodeMessage('')).toBeNull();
  expect(decodeMessage('not json')).toBeNull();
  expect(decodeMessage('[]')).toBeNull();
  expect(decodeMessage(JSON.stringify({ id: 1, result: {} }))).toBeNull();
  expect(decodeMessage(JSON.stringify({ jsonrpc: '1.0', id: 1, result: {} }))).toBeNull();
});

test('only an offered allow option selects approval', () => {
  const options = permissionOptions();
  expect(isApprovalOutcome({ outcome: 'selected', optionId: 'allow-once' }, options)).toBe(true);
  expect(isApprovalOutcome({ outcome: 'selected', optionId: 'allow-always' }, options)).toBe(true);
  expect(isApprovalOutcome({ outcome: 'selected', optionId: 'reject-once' }, options)).toBe(false);
  expect(isApprovalOutcome({ outcome: 'selected', optionId: 'made-up' }, options)).toBe(false);
  expect(isApprovalOutcome({ outcome: 'cancelled' }, options)).toBe(false);
  expect(isApprovalOutcome(undefined, options)).toBe(false);
});

test('a run status maps onto an ACP stop reason', () => {
  expect(stopReasonFor('ok')).toBe('end_turn');
  expect(stopReasonFor('limit')).toBe('max_turn_requests');
  expect(stopReasonFor('cancelled')).toBe('cancelled');
  expect(stopReasonFor('refused')).toBe('refusal');
  expect(stopReasonFor('error')).toBe('refusal');
});
