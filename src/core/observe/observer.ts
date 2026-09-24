import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

/** How much is logged: each level includes the ones before it. */
export const LEVELS = ['off', 'error', 'warn', 'info', 'debug'] as const;
export type Level = (typeof LEVELS)[number];
export const isLevel = (value: unknown): value is Level => typeof value === 'string' && (LEVELS as readonly string[]).includes(value);

export type AttributeValue = string | number | boolean;
export type Attributes = Record<string, AttributeValue | undefined>;

export interface LogRecord {
  ts: string;
  level: Exclude<Level, 'off'>;
  msg: string;
  [field: string]: unknown;
}

/** A finished span, as the trace file and the OpenTelemetry exporter receive it. */
export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** `client` for a request that leaves the process, such as a model request; `internal` otherwise. */
  kind: 'internal' | 'client';
  startMs: number;
  endMs: number;
  status: 'ok' | 'error';
  error?: string;
  attributes: Record<string, AttributeValue>;
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  /** Add attributes before the span ends. */
  set(attributes: Attributes): void;
  end(options?: { error?: string; attributes?: Attributes; endMs?: number }): void;
}

/** Where finished spans go: the trace file, and the OpenTelemetry exporter when one is configured. */
export interface SpanSink {
  write(span: SpanData): void;
  flush?(): Promise<void>;
}

export interface Observer {
  readonly level: Level;
  enabled(level: Exclude<Level, 'off'>): boolean;
  log(level: Exclude<Level, 'off'>, msg: string, fields?: Record<string, unknown>): void;
  startSpan(name: string, options?: { parent?: Span; kind?: SpanData['kind']; attributes?: Attributes; startMs?: number }): Span;
  flush(): Promise<void>;
}

const hex = (bytes: number) => randomBytes(bytes).toString('hex');

const clean = (attributes: Attributes | undefined): Record<string, AttributeValue> => {
  const out: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) if (value !== undefined) out[key] = value;
  return out;
};

/**
 * A file of JSON lines, opened on the first line written, so a run that logs nothing
 * leaves nothing behind. A file that cannot be written is given up on quietly: an
 * observer never breaks a session.
 */
export function jsonLinesFile(file: string, options: { onOpen?: () => void } = {}): { write(record: unknown): void } {
  let fd: number | undefined;
  let failed = false;
  return {
    write(record) {
      if (failed) return;
      try {
        if (fd === undefined) {
          fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
          fd = fs.openSync(file, 'a', 0o600);
          options.onOpen?.();
        }
        fs.writeSync(fd, `${JSON.stringify(record)}\n`);
      } catch {
        failed = true;
      }
    },
  };
}

/** The trace file: one finished span per line. */
export function traceFileSink(file: string): SpanSink {
  const out = jsonLinesFile(file);
  return {
    write: (span) =>
      out.write({
        trace_id: span.traceId,
        span_id: span.spanId,
        ...(span.parentSpanId ? { parent_span_id: span.parentSpanId } : {}),
        name: span.name,
        kind: span.kind,
        start: new Date(span.startMs).toISOString(),
        duration_ms: span.endMs - span.startMs,
        status: span.status,
        ...(span.error ? { error: span.error } : {}),
        attributes: span.attributes,
      }),
  };
}

export interface ObserverOptions {
  level?: Level;
  /** Where log lines go. None means logs are not written. */
  logFile?: string;
  /** Called when the log file is first opened, which is when the first line is written. */
  onLogOpen?: () => void;
  /** Also write each log line, readably, here: standard error on the command line. */
  echo?: (line: string) => void;
  /** Where finished spans go. None means spans are only timed, not kept. */
  spans?: SpanSink[];
  /** Applied to every message and string field, so no credential reaches a log. */
  redact?: (text: string) => string;
  now?: () => number;
}

const echoLine = (record: LogRecord): string => {
  const fields = Object.entries(record)
    .filter(([key]) => !['ts', 'level', 'msg'].includes(key))
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return `[${record.level}] ${record.msg}${fields.length ? ` ${fields.join(' ')}` : ''}`;
};

export function createObserver(options: ObserverOptions = {}): Observer {
  const level = options.level ?? 'warn';
  const rank = LEVELS.indexOf(level);
  const now = options.now ?? Date.now;
  const redact = options.redact ?? ((text: string) => text);
  const logOut = options.logFile ? jsonLinesFile(options.logFile, { onOpen: options.onLogOpen }) : undefined;
  const sinks = options.spans ?? [];
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => (item === undefined ? [] : [[key, scrub(item)]])));
    }
    return value;
  };

  const enabled = (at: Exclude<Level, 'off'>) => rank > 0 && LEVELS.indexOf(at) <= rank;

  return {
    level,
    enabled,
    log(at, msg, fields = {}) {
      if (!enabled(at)) return;
      const record = { ts: new Date(now()).toISOString(), level: at, msg: redact(msg), ...(scrub(fields) as object) } as LogRecord;
      logOut?.write(record);
      options.echo?.(echoLine(record));
    },
    startSpan(name, spanOptions = {}) {
      const parent = spanOptions.parent;
      const traceId = parent?.traceId ?? hex(16);
      const spanId = hex(8);
      const startMs = spanOptions.startMs ?? now();
      const attributes = clean(spanOptions.attributes);
      let ended = false;
      return {
        traceId,
        spanId,
        set(more) {
          Object.assign(attributes, clean(more));
        },
        end(endOptions = {}) {
          if (ended) return;
          ended = true;
          Object.assign(attributes, clean(endOptions.attributes));
          const data: SpanData = {
            traceId,
            spanId,
            ...(parent ? { parentSpanId: parent.spanId } : {}),
            name,
            kind: spanOptions.kind ?? 'internal',
            startMs,
            endMs: endOptions.endMs ?? now(),
            status: endOptions.error ? 'error' : 'ok',
            ...(endOptions.error ? { error: redact(endOptions.error) } : {}),
            attributes: Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, typeof value === 'string' ? redact(value) : value])),
          };
          for (const sink of sinks) {
            try {
              sink.write(data);
            } catch {
              // A sink that fails loses its span, not the session.
            }
          }
        },
      };
    },
    async flush() {
      await Promise.all(sinks.map((sink) => sink.flush?.().catch(() => undefined)));
    },
  };
}

/** Records nothing, for callers that were given no observer. */
export const silentObserver: Observer = createObserver({ level: 'off' });
