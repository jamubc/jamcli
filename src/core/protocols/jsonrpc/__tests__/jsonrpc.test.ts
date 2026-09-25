import { expect, test } from 'bun:test';
import { JsonRpcConnection } from '../connection.js';
import { contentLengthFraming, newlineFraming, type Framing } from '../framing.js';
import { JsonRpcError, METHOD_NOT_FOUND, toMessage, type JsonRpcMessage } from '../messages.js';

/** A small seeded generator, so a failing case can be run again. */
function random(seed: number) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const int = (max: number) => Math.floor(next() * max);
  const pick = <T,>(items: T[]) => items[int(items.length)];
  const text = () => Array.from({ length: int(12) }, () => pick(['a', 'z', ' ', '\n', '"', '\\', 'é', '漢', '😀', '\u0000', '{', '}', '\r', 'Content-Length: 9'])).join('');
  const value = (depth: number): unknown => {
    switch (int(depth > 2 ? 4 : 6)) {
      case 0:
        return text();
      case 1:
        return int(1_000_000) - 500_000;
      case 2:
        return pick([true, false, null]);
      case 3:
        return next();
      case 4:
        return Array.from({ length: int(4) }, () => value(depth + 1));
      default:
        return Object.fromEntries(Array.from({ length: int(4) }, () => [text(), value(depth + 1)]));
    }
  };
  const message = (): JsonRpcMessage => {
    switch (int(4)) {
      case 0:
        return { jsonrpc: '2.0', id: pick([int(1000), `id-${text()}`]), method: `m/${text()}`, params: value(0) };
      case 1:
        return { jsonrpc: '2.0', method: `n/${text()}`, params: value(0) };
      case 2:
        return { jsonrpc: '2.0', id: int(1000), result: value(0) };
      default:
        return { jsonrpc: '2.0', id: int(1000), error: { code: -int(40000), message: text(), data: value(0) } };
    }
  };
  return { int, message };
}

/** The same messages, split into chunks at random byte offsets. */
function roundTrip(framing: Framing, seed: number) {
  const { int, message } = random(seed);
  const messages = Array.from({ length: 1 + int(20) }, message);
  const bytes = messages.map((item) => framing.encode(item));
  const all = new Uint8Array(bytes.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of bytes) {
    all.set(part, offset);
    offset += part.length;
  }
  const decoder = framing.decoder();
  const decoded: JsonRpcMessage[] = [];
  const errors: string[] = [];
  for (let at = 0; at < all.length; ) {
    const size = 1 + int(Math.min(64, all.length - at));
    const out = decoder.push(all.subarray(at, at + size));
    decoded.push(...out.messages);
    errors.push(...out.errors);
    at += size;
  }
  // What JSON cannot carry, such as -0, reads back as JSON would.
  return { expected: JSON.parse(JSON.stringify(messages)), decoded, errors };
}

test('both framings carry any sequence of messages, however the bytes are split', () => {
  for (const framing of [newlineFraming, contentLengthFraming]) {
    for (let seed = 1; seed <= 300; seed += 1) {
      const { expected, decoded, errors } = roundTrip(framing, seed);
      if (errors.length || JSON.stringify(decoded) !== JSON.stringify(expected)) {
        throw new Error(`seed ${seed} failed for ${framing === newlineFraming ? 'newline' : 'Content-Length'} framing: ${errors.join('; ')}`);
      }
    }
  }
});

test('a frame that cannot be read is reported and skipped, and the next one still arrives', () => {
  const lines = newlineFraming.decoder();
  expect(lines.push('not json\n{"jsonrpc":"1.0","method":"x"}\n\n{"jsonrpc":"2.0","method":"ok"}\n')).toEqual({
    messages: [{ jsonrpc: '2.0', method: 'ok' }],
    errors: ['not JSON: not json', 'not a JSON-RPC 2.0 message: {"jsonrpc":"1.0","method":"x"}'],
  });
  // A line ending in \r\n, and one arriving in halves.
  expect(lines.push('{"jsonrpc":"2.0","method":"crlf"}\r\n{"jsonrpc":"2.0",').messages).toEqual([{ jsonrpc: '2.0', method: 'crlf' }]);
  expect(lines.push('"method":"late"}\n').messages).toEqual([{ jsonrpc: '2.0', method: 'late' }]);

  const frames = contentLengthFraming.decoder();
  const body = '{"jsonrpc":"2.0","method":"é"}';
  const size = new TextEncoder().encode(body).length;
  expect(frames.push(`X-Other: 1\r\n\r\nContent-Type: x\r\ncontent-length: ${size}\r\n\r\n${body.slice(0, 10)}`)).toEqual({ messages: [], errors: ['a frame has no Content-Length: X-Other: 1'] });
  expect(frames.push(body.slice(10)).messages).toEqual([{ jsonrpc: '2.0', method: 'é' }]);
  // Content-Length counts bytes, not characters.
  expect(size).toBe(body.length + 1);
});

test('only JSON-RPC 2.0 shapes are messages', () => {
  expect(toMessage({ jsonrpc: '2.0', id: 1, method: 'a' })).toEqual({ jsonrpc: '2.0', id: 1, method: 'a' });
  expect(toMessage({ jsonrpc: '2.0', id: {}, method: 'a' })).toBeNull();
  expect(toMessage({ jsonrpc: '2.0', id: 1, error: { code: 'x', message: 'm' } })).toBeNull();
  expect(toMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'bad' } })).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'bad' } });
  expect(toMessage([])).toBeNull();
  expect(toMessage({ jsonrpc: '2.0' })).toBeNull();
});

/** Two connections wired back to back. */
function pair(framing: Framing, timeoutMs = 2_000) {
  let left!: JsonRpcConnection;
  let right!: JsonRpcConnection;
  const errors: string[] = [];
  left = new JsonRpcConnection({ framing, write: (bytes) => queueMicrotask(() => right.receive(bytes)), onError: (e) => errors.push(e), requestTimeoutMs: timeoutMs });
  right = new JsonRpcConnection({ framing, write: (bytes) => queueMicrotask(() => left.receive(bytes)), onError: (e) => errors.push(e), requestTimeoutMs: timeoutMs });
  return { left, right, errors };
}

test('requests get their own answers, notifications arrive, and failures come back as errors', async () => {
  for (const framing of [newlineFraming, contentLengthFraming]) {
    const { left, right, errors } = pair(framing);
    const heard: unknown[] = [];
    right.onRequest('add', ({ a, b }) => a + b);
    right.onRequest('slow', async (ms: number) => {
      await Bun.sleep(ms);
      return ms;
    });
    right.onRequest('refuse', () => {
      throw new JsonRpcError(-32001, 'not allowed', { why: 'test' });
    });
    right.onRequest('crash', () => {
      throw new Error('boom');
    });
    right.onNotification('note', (params) => heard.push(params));
    // Answers are matched by id, not by order.
    const [slow, fast] = await Promise.all([left.request('slow', 30), left.request('add', { a: 2, b: 3 })]);
    expect([slow, fast]).toEqual([30, 5]);
    left.notify('note', { text: 'hi' });
    await Bun.sleep(5);
    expect(heard).toEqual([{ text: 'hi' }]);
    await expect(left.request('nope')).rejects.toMatchObject({ code: METHOD_NOT_FOUND, message: 'No method nope' });
    await expect(left.request('refuse')).rejects.toMatchObject({ code: -32001, message: 'not allowed', data: { why: 'test' } });
    await expect(left.request('crash')).rejects.toMatchObject({ code: -32603, message: 'boom' });
    expect(errors).toEqual([]);
  }
});

test('a request not answered in time, cancelled, or cut off by closing is rejected', async () => {
  const { left, right } = pair(newlineFraming, 50);
  right.onRequest('never', () => new Promise(() => undefined));
  await expect(left.request('never')).rejects.toThrow('never was not answered within 50 ms');
  const controller = new AbortController();
  const cancelled = left.request('never', undefined, { timeoutMs: 5_000, signal: controller.signal });
  controller.abort();
  await expect(cancelled).rejects.toThrow('never was cancelled');
  const cut = left.request('never', undefined, { timeoutMs: 5_000 });
  left.close('the server exited');
  await expect(cut).rejects.toThrow('the server exited');
  await expect(left.request('never')).rejects.toThrow('the server exited');
  expect(left.isClosed).toBe(true);
});
