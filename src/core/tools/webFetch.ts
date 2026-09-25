import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';

/**
 * `web_fetch` (D5): a URL to readable text. Its class is `network`, so every mode but
 * bypass asks unless a rule such as `web_fetch(domain:docs.python.org)` allows the host.
 * A redirect to another host is not followed: the model is told where it points and
 * fetches that URL in a new call, which the rules judge for its own host.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;

const schema: JsonSchema = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'An http or https URL.' },
  },
  required: ['url'],
  additionalProperties: false,
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

/** HTML as readable text: scripts, styles, and markup removed, blocks on their own lines. */
export function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => `\n\n${'#'.repeat(Number(level))} `)
    .replace(/<\/(p|div|section|article|header|footer|main|nav|aside|h[1-6]|ul|ol|table|tr|pre|blockquote)\s*>/gi, '\n\n')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(/<[^>]+>/g, '');
  const text = decode(body)
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\r]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const heading = title ? decode(title).replace(/\s+/g, ' ').trim() : '';
  return heading && !text.startsWith(heading) ? `${heading}\n\n${text}` : text;
}

const isText = (type: string) => /^text\/|[/+](json|xml|javascript|ecmascript|yaml|x-yaml|markdown)\b/.test(type) || type === '';

async function readCapped(response: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > MAX_BYTES) {
      chunks.push(value.subarray(0, MAX_BYTES - size));
      size = MAX_BYTES;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

export async function webFetch(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  let url: URL;
  try {
    url = new URL(String(args.url ?? ''));
  } catch {
    return { output: `Refused: ${String(args.url ?? '')} is not a URL.` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { output: `Refused: only http and https URLs are fetched, not ${url.protocol}` };
  url.hash = '';

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
  let response: Response;
  let current = url;
  try {
    for (let hops = 0; ; hops += 1) {
      response = await fetch(current, { redirect: 'manual', signal, headers: { accept: 'text/html, text/plain, text/markdown, application/json, */*;q=0.5', 'user-agent': 'jamcli web_fetch' } });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) break;
      const next = new URL(location, current);
      if (next.host !== url.host) {
        await response.body?.cancel().catch(() => {});
        return { output: `${current.href} redirects to ${next.href}, on another host. Fetch that URL to follow it.` };
      }
      if (hops + 1 >= MAX_REDIRECTS) {
        await response.body?.cancel().catch(() => {});
        return { output: `${url.href} redirected more than ${MAX_REDIRECTS} times; stopped at ${next.href}.` };
      }
      await response.body?.cancel().catch(() => {});
      current = next;
    }
  } catch (error: any) {
    const reason = timeout.aborted ? `it took longer than ${TIMEOUT_MS / 1000} seconds` : ctx.signal?.aborted ? 'it was cancelled' : error?.cause?.code ?? error?.message ?? String(error);
    return { output: `Could not fetch ${current.href}: ${reason}.` };
  }

  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const heading = `${current.href} (${response.status}${type ? `, ${type}` : ''})`;
  if (!isText(type)) {
    await response.body?.cancel().catch(() => {});
    return { output: `${heading}\n\nNot fetched: ${type} is not text.` };
  }
  const { bytes, truncated } = await readCapped(response);
  const raw = new TextDecoder().decode(bytes);
  const text = type === 'text/html' || type === 'application/xhtml+xml' ? htmlToText(raw) : raw;
  return { output: `${heading}\n\n${text}${truncated ? `\n\n[Cut at ${MAX_BYTES / 1024 / 1024} MB.]` : ''}` };
}

export const WEB_FETCH_TOOL: RegisteredTool = {
  name: 'web_fetch',
  description: 'Fetch a URL and return it as readable text. HTML is reduced to its text; other text types come back as they are.',
  inputSchema: schema,
  policy: 'network',
  runner: webFetch,
};
