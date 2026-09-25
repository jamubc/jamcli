import { toMessage, type JsonRpcMessage } from './messages.js';

/**
 * Two framings for one message layer. A decoder takes bytes as they arrive, split
 * anywhere, and yields whole messages in order; an encoder turns a message into bytes.
 * What cannot be read is reported and skipped, so one bad frame never stops the stream.
 */

export interface Framing {
  encode(message: JsonRpcMessage): Uint8Array;
  decoder(): Decoder;
}

export interface Decoder {
  /** Take the next bytes; return the messages they complete, and what could not be read. */
  push(chunk: Uint8Array | string): { messages: JsonRpcMessage[]; errors: string[] };
}

const encoder = new TextEncoder();

function parse(text: string, errors: string[]): JsonRpcMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    errors.push(`not JSON: ${text.slice(0, 80)}`);
    return undefined;
  }
  const message = toMessage(value);
  if (!message) errors.push(`not a JSON-RPC 2.0 message: ${text.slice(0, 80)}`);
  return message ?? undefined;
}

const bytesOf = (chunk: Uint8Array | string) => (typeof chunk === 'string' ? encoder.encode(chunk) : chunk);

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) return b;
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}

/** One JSON message per line, as ACP and MCP over stdio send them. */
export const newlineFraming: Framing = {
  encode: (message) => encoder.encode(`${JSON.stringify(message)}\n`),
  decoder() {
    let pending: Uint8Array = new Uint8Array(0);
    const utf8 = new TextDecoder();
    return {
      push(chunk) {
        pending = concat(pending, bytesOf(chunk));
        const messages: JsonRpcMessage[] = [];
        const errors: string[] = [];
        let start = 0;
        for (let index = pending.indexOf(10); index !== -1; index = pending.indexOf(10, start)) {
          // Lines are cut on bytes, so a character split across chunks is whole by now. A
          // trailing \r is whitespace to JSON.parse.
          const line = utf8.decode(pending.subarray(start, index));
          start = index + 1;
          if (!line.trim()) continue;
          const message = parse(line, errors);
          if (message) messages.push(message);
        }
        pending = pending.slice(start);
        return { messages, errors };
      },
    };
  },
};

/** `Content-Length` headers, then that many bytes of JSON, as LSP sends them. */
export const contentLengthFraming: Framing = {
  encode(message) {
    const body = encoder.encode(JSON.stringify(message));
    return concat(encoder.encode(`Content-Length: ${body.length}\r\n\r\n`), body);
  },
  decoder() {
    let pending: Uint8Array = new Uint8Array(0);
    const utf8 = new TextDecoder();
    const HEADER_END = encoder.encode('\r\n\r\n');
    const find = (haystack: Uint8Array, needle: Uint8Array) => {
      outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
        for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
        return i;
      }
      return -1;
    };
    return {
      push(chunk) {
        pending = concat(pending, bytesOf(chunk));
        const messages: JsonRpcMessage[] = [];
        const errors: string[] = [];
        for (;;) {
          const end = find(pending, HEADER_END);
          if (end === -1) break;
          const headers = utf8.decode(pending.subarray(0, end));
          const length = /(?:^|\r\n)content-length:\s*(\d+)/i.exec(headers);
          if (!length) {
            errors.push(`a frame has no Content-Length: ${headers.slice(0, 80)}`);
            pending = pending.slice(end + HEADER_END.length);
            continue;
          }
          const size = Number(length[1]);
          const bodyStart = end + HEADER_END.length;
          if (pending.length < bodyStart + size) break;
          const message = parse(utf8.decode(pending.subarray(bodyStart, bodyStart + size)), errors);
          if (message) messages.push(message);
          pending = pending.slice(bodyStart + size);
        }
        return { messages, errors };
      },
    };
  },
};
