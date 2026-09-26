import type { ToolContext } from '../../../types/tools.js';
import type { SearchResult } from './providers.js';

/**
 * The refinement pipe: results and fetched text pass through here untouched.
 *
 * The intended first occupant is the TypeSafe System One gate (model jev-latest) from
 * opencode-langsearch/src/index.ts:776-1148. It is deferred to a later unit; it fails
 * open, and it needs TYPESAFE_API_KEY when it lands.
 */
export async function refineSearch(
  query: string,
  results: SearchResult[],
  ctx: ToolContext
): Promise<SearchResult[]> {
  return results;
}

export async function refineFetch(
  url: string,
  text: string,
  prompt: string | undefined,
  ctx: ToolContext
): Promise<string> {
  return text;
}
