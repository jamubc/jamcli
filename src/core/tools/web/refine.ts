import type { ToolContext } from '../../../types/tools.js';
import type { SearchResult } from './providers.js';

/**
 * The refinement pipe: search results pass through here untouched, and a fetched page is
 * narrowed to what a prompt asks for.
 *
 * A model-based gate, the TypeSafe System One gate (model jev-latest) from
 * opencode-langsearch/src/index.ts:776-1148, was meant to fill the search side. It is
 * deferred to a later unit; it fails open, and it needs TYPESAFE_API_KEY when it lands.
 */
export async function refineSearch(
  _query: string,
  results: SearchResult[],
  _ctx: ToolContext
): Promise<SearchResult[]> {
  return results;
}

/** A page shorter than this comes back whole, with or without a prompt. */
const FILTER_ABOVE_CHARS = 9_000;
/** What a filtered page keeps of a long one. */
const KEEP_CHARS = 6_000;
/** A paragraph longer than this is split by line, so one long block cannot spend the whole budget. */
const MAX_PARAGRAPH_CHARS = 1_500;
const MAX_KEYWORDS = 24;

const STOP_WORDS = new Set(
  'the and for with that this from what how which about into are was were has have had their there its not can all any more most than then also each does did who whom whose when where why our your they them these those been being over under such only very between across using used use'.split(' ')
);

/** The words of a prompt worth looking for on a page, lowercased, without the common ones. */
const keywordsOf = (prompt: string): string[] => {
  const seen = new Set<string>();
  for (const word of prompt.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_.+-]{2,}/gu) ?? []) {
    if (!STOP_WORDS.has(word)) seen.add(word.replace(/[.+-]+$/, ''));
  }
  return [...seen].slice(0, MAX_KEYWORDS);
};

/** The page's paragraphs in order, a long block split by line. */
const paragraphsOf = (text: string): string[] =>
  text
    .split(/\n{2,}/)
    .flatMap((block) => {
      if (block.length <= MAX_PARAGRAPH_CHARS) return [block];
      const parts: string[] = [];
      let current = '';
      for (const line of block.split('\n')) {
        if (current && current.length + line.length > MAX_PARAGRAPH_CHARS) (parts.push(current), (current = ''));
        current += `${current ? '\n' : ''}${line}`;
      }
      return current ? [...parts, current] : parts;
    })
    .filter((block) => block.trim());

/**
 * What a fetch returns once it has read the page. With a prompt, a page longer than
 * {@link FILTER_ABOVE_CHARS} comes back as the paragraphs that mention the prompt's words,
 * best first until {@link KEEP_CHARS} are spent, in page order, with the page's own length
 * and how to get all of it. Nothing is guessed: a paragraph is kept for the words it holds,
 * and a page that holds none of them comes back from its start. With no prompt, or a short
 * page, the text is returned as it is. The seam is the one a model-based gate was meant to
 * fill; this needs no key and no model, so it holds on the local path too.
 */
export async function refineFetch(
  _url: string,
  text: string,
  prompt: string | undefined,
  _ctx: ToolContext
): Promise<string> {
  const wanted = prompt ? keywordsOf(prompt) : [];
  if (!wanted.length || text.length <= FILTER_ABOVE_CHARS) return text;
  const [heading, ...rest] = text.split('\n\n');
  const paragraphs = paragraphsOf(rest.join('\n\n'));
  const scored = paragraphs.map((paragraph, index) => {
    const lower = paragraph.toLowerCase();
    const hits = wanted.filter((word) => lower.includes(word)).length;
    // A heading that holds a word points at the section under it.
    const bonus = /^#{1,6} /.test(paragraph) && hits ? 1 : 0;
    return { index, paragraph, score: hits + bonus + Math.min(1, hits / Math.max(1, paragraph.length / 400)) * 0.5 };
  });
  const chosen: typeof scored = [];
  let spent = 0;
  // The page's first paragraph says what it is, so it is kept when it fits.
  const first = scored[0];
  if (first && first.paragraph.length <= 600) (chosen.push(first), (spent += first.paragraph.length));
  for (const entry of [...scored].filter((entry) => entry.score > 0 && !chosen.includes(entry)).sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (spent + entry.paragraph.length > KEEP_CHARS) continue;
    chosen.push(entry);
    spent += entry.paragraph.length;
  }
  const kept = chosen.sort((a, b) => a.index - b.index);
  const matched = kept.some((entry) => entry.score > 0 && entry !== first) || (kept.length > 0 && kept[0] === first && first.score > 0);
  const body = matched
    ? kept.map((entry, at) => `${at > 0 && entry.index !== kept[at - 1].index + 1 ? '[...]\n\n' : ''}${entry.paragraph}`).join('\n\n')
    : text.slice(heading.length + 2, heading.length + 2 + KEEP_CHARS);
  const asked = (prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${heading}\n\n${body}\n\n[Showing ${body.length.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')} characters: ${matched ? `the parts that mention ${JSON.stringify(asked)}` : `the start of the page, since nothing on it mentions ${JSON.stringify(asked)}`}. Call web_fetch again without a prompt for the whole page.]`;
}
