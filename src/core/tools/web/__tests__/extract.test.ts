import { expect, test } from 'bun:test';
import { htmlToText } from '../extract.js';

test('a link survives as a markdown link with its words and target', () => {
  expect(htmlToText('<p>See <a href="https://example.com/docs">the docs</a>.</p>')).toBe('See [the docs](https://example.com/docs).');
});

test('a relative link resolves against the page URL', () => {
  expect(htmlToText('<a href="/guide">Guide</a>', 'https://example.com/start/here')).toBe('[Guide](https://example.com/guide)');
});

test('navigation, footers, and asides are dropped', () => {
  const html = '<nav><a href="/x">menu</a></nav><main><p>Body</p></main><footer>fine print</footer><aside>ad</aside>';
  expect(htmlToText(html)).toBe('Body');
});

test('main wins over the rest of the document when present', () => {
  expect(htmlToText('<header>top</header><main><h1>Title</h1><p>Only this.</p></main>')).toBe('# Title\n\nOnly this.');
});

test('malformed HTML with no main still returns the document text', () => {
  expect(htmlToText('<div>one<b>two')).toBe('onetwo');
});

test('a page with nothing readable returns an empty string, never a throw', () => {
  expect(htmlToText('<script>var x = 1;</script>')).toBe('');
});

test('entities decode and markup inside text is dropped, as before', () => {
  expect(htmlToText('<p>a &lt;b&gt; &#65;&#x42; <!-- note --> <b>c</b></p>')).toBe('a <b> AB c');
});

test('a javascript: link keeps its words and drops the target', () => {
  expect(htmlToText('<a href="javascript:alert(1)">click</a>')).toBe('click');
});

test('the page title heads the text when the body does not repeat it', () => {
  expect(htmlToText('<html><head><title>Docs &amp; notes</title></head><body><p>Install</p></body></html>')).toBe('Docs & notes\n\nInstall');
});
