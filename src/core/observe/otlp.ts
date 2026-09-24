import { JAMCLI_VERSION } from '../version.js';
import type { AttributeValue, SpanData, SpanSink } from './observer.js';

/** The `otel` block of configuration. */
export interface OtelSettings {
  /** Off by default: nothing leaves the machine unless this is true. */
  enabled?: boolean;
  /** Where to post traces. Defaults to the OTEL_EXPORTER_OTLP_* variables, then http://localhost:4318/v1/traces. */
  endpoint?: string;
  /** Headers sent with every export, over OTEL_EXPORTER_OTLP_HEADERS. */
  headers?: Record<string, string>;
  /** Put prompts, outputs, tool arguments, and tool results on spans. Off by default. */
  include_content?: boolean;
}

type Env = Record<string, string | undefined>;

/** `key=value,key2=value2`, percent-decoded, as the OpenTelemetry variables write headers and resource attributes. */
export function parseKeyValues(text: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (text ?? '').split(',')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    try {
      out[decodeURIComponent(part.slice(0, at).trim())] = decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      // A pair that is not valid percent-encoding is skipped.
    }
  }
  return out;
}

/** Where traces go and with what headers, from configuration and then the standard variables. */
export function exportTarget(settings: OtelSettings, env: Env): { url: string; headers: Record<string, string> } {
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const url =
    settings.endpoint?.trim() ||
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ||
    (base ? `${base.replace(/\/+$/, '')}/v1/traces` : 'http://localhost:4318/v1/traces');
  return {
    url,
    headers: { ...parseKeyValues(env.OTEL_EXPORTER_OTLP_HEADERS), ...parseKeyValues(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS), ...(settings.headers ?? {}) },
  };
}

type OtlpValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean };

const otlpValue = (value: AttributeValue): OtlpValue =>
  typeof value === 'boolean'
    ? { boolValue: value }
    : typeof value === 'number'
      ? Number.isInteger(value)
        ? { intValue: String(value) }
        : { doubleValue: value }
      : { stringValue: value };

const otlpAttributes = (attributes: Record<string, AttributeValue>) =>
  Object.entries(attributes).map(([key, value]) => ({ key, value: otlpValue(value) }));

const nanos = (ms: number) => `${BigInt(Math.round(ms * 1000)) * 1000n}`;

/** Spans as one OTLP/HTTP JSON export request. */
export function otlpPayload(spans: SpanData[], env: Env = {}): Record<string, unknown> {
  const resource = {
    'service.name': env.OTEL_SERVICE_NAME?.trim() || 'jamcli',
    'service.version': JAMCLI_VERSION,
    ...parseKeyValues(env.OTEL_RESOURCE_ATTRIBUTES),
  };
  return {
    resourceSpans: [
      {
        resource: { attributes: otlpAttributes(resource) },
        scopeSpans: [
          {
            scope: { name: 'jamcli', version: JAMCLI_VERSION },
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              // SPAN_KIND_INTERNAL and SPAN_KIND_CLIENT.
              kind: span.kind === 'client' ? 3 : 1,
              startTimeUnixNano: nanos(span.startMs),
              endTimeUnixNano: nanos(span.endMs),
              attributes: otlpAttributes(span.attributes),
              // STATUS_CODE_OK and STATUS_CODE_ERROR.
              status: span.status === 'error' ? { code: 2, ...(span.error ? { message: span.error } : {}) } : { code: 1 },
            })),
          },
        ],
      },
    ],
  };
}

export interface OtlpExporterOptions {
  url: string;
  headers?: Record<string, string>;
  env?: Env;
  /** Spans held before a send; the rest wait for the timer or the end of the session. */
  batchSize?: number;
  intervalMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Told once when an export fails; later failures are dropped quietly. */
  onError?: (message: string) => void;
}

/**
 * Posts finished spans to an OTLP/HTTP endpoint as JSON, in batches, and whatever is
 * left when the session ends. A failed export is reported once and its spans dropped;
 * the session never waits on the collector beyond the timeout.
 */
export function otlpExporter(options: OtlpExporterOptions): SpanSink {
  const batchSize = options.batchSize ?? 64;
  const doFetch = options.fetch ?? fetch;
  let queue: SpanData[] = [];
  let reported = false;
  const inFlight = new Set<Promise<void>>();

  const send = (spans: SpanData[]) => {
    if (!spans.length) return;
    const attempt = (async () => {
      try {
        const response = await doFetch(options.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
          body: JSON.stringify(otlpPayload(spans, options.env)),
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
        if (!response.ok) throw new Error(`the collector answered ${response.status}`);
      } catch (error: any) {
        if (!reported) {
          reported = true;
          options.onError?.(`Traces could not be sent to ${options.url}: ${error?.message ?? error}. Later failures are not reported.`);
        }
      }
    })();
    inFlight.add(attempt);
    void attempt.finally(() => inFlight.delete(attempt));
  };
  const drain = () => {
    const spans = queue;
    queue = [];
    send(spans);
  };
  const timer = setInterval(drain, options.intervalMs ?? 5_000);
  // The timer never keeps a finished run alive.
  (timer as { unref?: () => void }).unref?.();

  return {
    write(span) {
      queue.push(span);
      if (queue.length >= batchSize) drain();
    },
    async flush() {
      drain();
      await Promise.all([...inFlight]);
    },
  };
}
