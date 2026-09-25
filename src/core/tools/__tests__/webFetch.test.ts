import { afterAll, beforeAll, expect, test } from 'bun:test';
import { subjectsOf } from '../../permissions/subjects.js';
import { createBuiltinRegistry } from '../registry.js';
import { htmlToText } from '../webFetch.js';

let server: ReturnType<typeof Bun.serve>;
let other: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  other = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('elsewhere') });
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === '/page')
        return new Response('<html><head><title>Docs &amp; notes</title><style>p{}</style><script>alert(1)</script></head><body><h1>Install</h1><p>Run <code>make</code>.</p><ul><li>one</li><li>two</li></ul></body></html>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      if (pathname === '/json') return Response.json({ ok: true });
      if (pathname === '/moved') return new Response(null, { status: 301, headers: { location: '/json' } });
      if (pathname === '/away') return new Response(null, { status: 302, headers: { location: `http://localhost:${other.port}/x` } });
      if (pathname === '/loop') return new Response(null, { status: 302, headers: { location: '/loop' } });
      if (pathname === '/image') return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
      return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  other.stop(true);
});

const fetchUrl = (url: string) => createBuiltinRegistry().execute('web_fetch', { url }, { projectRoot: process.cwd() });

test('HTML comes back as readable text, without scripts or styles', async () => {
  const result = await fetchUrl(`${base}/page`);
  expect(result.success).toBe(true);
  expect(result.output).toBe(`${base}/page (200, text/html)\n\nDocs & notes\n\n# Install\n\nRun make.\n\n- one\n- two`);
});

test('text types come back as they are, and a same-host redirect is followed', async () => {
  expect((await fetchUrl(`${base}/moved`)).output).toBe(`${base}/json (200, application/json)\n\n{"ok":true}`);
  expect((await fetchUrl(`${base}/nothing`)).output).toBe(`${base}/nothing (404, text/plain)\n\nmissing`);
});

test('a redirect to another host is reported, not followed, so the rules judge that host', async () => {
  const result = await fetchUrl(`${base}/away`);
  expect(result.output).toBe(`${base}/away redirects to http://localhost:${other.port}/x, on another host. Fetch that URL to follow it.`);
  expect((await fetchUrl(`${base}/loop`)).output).toContain('redirected more than 5 times');
});

test('binary content, other schemes, and bad URLs are refused', async () => {
  expect((await fetchUrl(`${base}/image`)).output).toBe(`${base}/image (200, image/png)\n\nNot fetched: image/png is not text.`);
  expect((await fetchUrl('file:///etc/passwd')).output).toBe('Refused: only http and https URLs are fetched, not file:');
  expect((await fetchUrl('not a url')).output).toBe('Refused: not a url is not a URL.');
});

test('it is a network tool, and rules see the host it reaches', () => {
  const tool = createBuiltinRegistry().get('web_fetch');
  expect(tool?.policy).toBe('network');
  expect(subjectsOf({ id: 'c', name: 'web_fetch', arguments: { url: 'https://docs.python.org/3/' } }, 'web_fetch', '/tmp').subjects).toEqual([{ kind: 'domain', value: 'docs.python.org' }]);
});

test('entities decode, and markup inside text is dropped', () => {
  expect(htmlToText('<p>a &lt;b&gt; &#65;&#x42; <!-- note --> <b>c</b></p>')).toBe('a <b> AB c');
});
