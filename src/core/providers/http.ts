/**
 * The HTTP layer every provider shares: retries for transient failures, and errors that
 * carry the provider's own message and a suggested fix instead of a bare status code.
 */

export interface RetryInfo {
  attempt: number;
  delayMs: number;
  reason: string;
}

export interface RetryPolicy {
  /** Total attempts, including the first. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 20_000 };

/** Statuses worth retrying: timeouts, conflicts, rate limits, and server-side failures. */
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

const MAX_ERROR_TEXT = 500;

export class ProviderError extends Error {
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly hint?: string;
  readonly detail?: string;

  constructor(options: { provider: string; status?: number; detail?: string; retryable?: boolean; hint?: string; message?: string }) {
    const status = options.status ? ` returned ${options.status}` : ' could not be reached';
    const detail = options.detail ? `: ${options.detail}` : '';
    const hint = options.hint ? ` ${options.hint}` : '';
    super(options.message ?? `${options.provider}${status}${detail}.${hint}`);
    this.name = 'ProviderError';
    this.provider = options.provider;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.hint = options.hint;
    this.detail = options.detail;
  }
}

/** Remove anything that looks like a credential from text that may be shown or logged. */
export const scrubSecrets = (text: string, secrets: (string | undefined)[] = []): string => {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join('[redacted]');
  }
  return out
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [redacted]');
};

/** Pull the human-readable message out of the error bodies providers return. */
export const extractErrorText = (body: string): string => {
  const trimmed = body.trim();
  if (!trimmed) return '';
  try {
    const json = JSON.parse(trimmed);
    const candidate =
      json?.error?.message ??
      (typeof json?.error === 'string' ? json.error : undefined) ??
      json?.message ??
      json?.detail ??
      json?.error?.type;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, MAX_ERROR_TEXT);
  } catch {
    // Not JSON; use the text itself.
  }
  return trimmed.replace(/\s+/g, ' ').slice(0, MAX_ERROR_TEXT);
};

/** Seconds, an HTTP date, or `retry-after-ms`, converted to a delay in milliseconds. */
export const parseRetryAfter = (headers: Headers): number | undefined => {
  const ms = headers.get('retry-after-ms');
  if (ms && Number.isFinite(Number(ms))) return Math.max(0, Number(ms));
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
};

/** A suggested fix for the failures people hit most. */
export const hintFor = (provider: string, status: number | undefined, detail: string, keyVariable?: string): string | undefined => {
  const text = detail.toLowerCase();
  if (status === undefined && provider === 'ollama') {
    return 'Start Ollama with `ollama serve`, or choose another provider with /model.';
  }
  if (status === undefined) return 'Check the network connection and the endpoint URL.';
  if (status === 401 || status === 403) {
    return keyVariable ? `Check the key in ${keyVariable}, or run \`jamcli auth set ${provider}\`.` : 'Check the API key for this provider.';
  }
  if (status === 404 && /model/.test(text)) return 'The model is not available here; choose another with /model.';
  if (/context|too long|maximum.*tokens|token limit/.test(text)) return 'The conversation is too long for this model; run /compact.';
  if (status === 429) return 'The provider is rate limiting requests; wait or switch models.';
  return undefined;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' }));
      },
      { once: true }
    );
  });

const backoff = (attempt: number, policy: RetryPolicy): number => {
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  const jitter = exponential * (0.8 + Math.random() * 0.4);
  return Math.min(policy.maxDelayMs, Math.round(jitter));
};

export interface FetchRetryOptions {
  provider: string;
  signal?: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
  policy?: RetryPolicy;
  /** Secrets to keep out of error text. */
  secrets?: (string | undefined)[];
  keyVariable?: string;
}

/**
 * Send a request, retrying network failures and retryable statuses with backoff and
 * honoring the provider's retry delay. Resolves with the first successful response;
 * throws a `ProviderError` carrying the provider's message otherwise. Only the request
 * is retried: a stream that fails after it has started is the caller's to report.
 */
export async function fetchWithRetry(url: string, init: RequestInit, options: FetchRetryOptions): Promise<Response> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await globalThis.fetch(url, { ...init, signal: options.signal });
    } catch (error: any) {
      if (error?.name === 'AbortError' || options.signal?.aborted) throw error;
      const reason = scrubSecrets(String(error?.message ?? error), options.secrets);
      if (attempt >= policy.maxAttempts) {
        throw new ProviderError({
          provider: options.provider,
          detail: reason,
          retryable: true,
          hint: hintFor(options.provider, undefined, reason, options.keyVariable),
        });
      }
      const delayMs = backoff(attempt, policy);
      options.onRetry?.({ attempt, delayMs, reason: `network error: ${reason}` });
      await sleep(delayMs, options.signal);
      continue;
    }

    if (response.ok) return response;

    const body = await response.text().catch(() => '');
    const detail = scrubSecrets(extractErrorText(body), options.secrets);
    const retryable = RETRYABLE_STATUSES.has(response.status);
    if (retryable && attempt < policy.maxAttempts) {
      const delayMs = Math.min(parseRetryAfter(response.headers) ?? backoff(attempt, policy), policy.maxDelayMs);
      options.onRetry?.({ attempt, delayMs, reason: `${response.status}${detail ? ` ${detail}` : ''}` });
      await sleep(delayMs, options.signal);
      continue;
    }
    throw new ProviderError({
      provider: options.provider,
      status: response.status,
      detail,
      retryable,
      hint: hintFor(options.provider, response.status, detail, options.keyVariable),
    });
  }
}
