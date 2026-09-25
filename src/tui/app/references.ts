import { listPaths } from '../../core/tools/search.js';
import type { Runtime } from '../../core/runtime/index.js';

/** Something `@` can name: a file or directory in the project, or an MCP server's resource. */
export interface ReferenceItem {
  /** What completing it puts in the composer, after the `@`. */
  text: string;
  /** What it is, shown beside it. */
  detail: string;
}

/** The `@` word being typed at the end of the composer, without the `@`, or nothing. */
export const referenceToken = (draft: string): string | undefined => /(?:^|\s)@(\S*)$/.exec(draft)?.[1];

/** Everything `@` can name now: the project's paths, as ignore files leave them, and the MCP resources. */
export async function referenceCandidates(runtime: Runtime): Promise<ReferenceItem[]> {
  const [listed, resources] = await Promise.all([
    listPaths({ root: runtime.workRoot, limit: 5000, includeDirs: true, timeoutMs: 2000 }).catch(() => ({ paths: [] as { rel: string; isDir: boolean }[] })),
    runtime.mcpResources().catch(() => []),
  ]);
  return [
    ...listed.paths.map((entry) => ({ text: entry.isDir ? `${entry.rel}/` : entry.rel, detail: entry.isDir ? 'directory' : 'file' })),
    ...resources.map((resource) => ({ text: `${resource.serverId}:${resource.uri}`, detail: `${resource.name} from MCP server ${resource.serverId}` })),
  ];
}

/** The candidates a typed word could mean: names that start with it, then paths that contain it. */
export function matchReferences(items: ReferenceItem[], typed: string, limit = 50): ReferenceItem[] {
  const wanted = typed.toLowerCase();
  const base = (text: string) => text.replace(/\/$/, '').split('/').pop()!.toLowerCase();
  const starts = items.filter((item) => item.text.toLowerCase().startsWith(wanted) || base(item.text).startsWith(wanted));
  const contains = wanted ? items.filter((item) => !starts.includes(item) && item.text.toLowerCase().includes(wanted)) : [];
  // Shorter names first within each group, so a directory comes before what is in it.
  const byLength = (a: ReferenceItem, b: ReferenceItem) => a.text.length - b.text.length || a.text.localeCompare(b.text);
  return [...starts.sort(byLength), ...contains.sort(byLength)].slice(0, limit);
}

/** The draft with its last `@` word replaced by the chosen reference. */
export const completeReference = (draft: string, item: ReferenceItem): string => draft.replace(/@(\S*)$/, `@${item.text}${item.text.endsWith('/') ? '' : ' '}`);
