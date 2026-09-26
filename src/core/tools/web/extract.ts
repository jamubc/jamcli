/**
 * HTML as readable text: scripts, styles, and markup removed, links kept as markdown,
 * navigation and footers dropped, blocks on their own lines. Pure: no DOM, no network.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

const absolute = (href: string, base?: string): string => {
  if (!href || /^javascript:/i.test(href)) return '';
  if (!base || href.startsWith('#')) return href;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
};

/** `<main>` or `<article>` is the content root when present; the whole document otherwise. */
const contentRoot = (html: string): string => {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html) ?? /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  return main ? main[1] : html;
};

const links = (html: string, base?: string): string =>
  html.replace(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_whole, _quote: string, href: string, label: string) => {
    const words = decode(label.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const target = absolute(href.trim(), base);
    if (!target) return words;
    return words ? `[${words}](${target})` : `[${target}](${target})`;
  });

export function htmlToText(html: string, baseUrl?: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = links(
    contentRoot(html)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|noscript|template|svg|head|nav|footer|aside)\b[\s\S]*?<\/\1\s*>/gi, ''),
    baseUrl
  )
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
