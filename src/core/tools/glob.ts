import fs from 'fs';
import path from 'path';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { resolveIgnorePatterns } from './ignore.js';
import { resolveProjectPath } from './paths.js';
import { listPaths } from './search.js';

const DEFAULT_GLOB_PATTERN = '**/*';
const MAX_GLOB_RESULTS = 1000;
const DEFAULT_GLOB_LIMIT = 100;
/** Paths collected for sorting by recency before the limit applies. */
const SORT_CAP = 10_000;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * List paths matching a gitignore-style glob, most recently modified first. Ignore
 * files, configured ignore patterns, and hidden-file rules apply, through ripgrep when
 * it is available and an equivalent walk otherwise.
 */
export async function globRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const pattern = typeof args.pattern === 'string' && args.pattern ? args.pattern : DEFAULT_GLOB_PATTERN;
  const limit = clamp(typeof args.limit === 'number' ? args.limit : DEFAULT_GLOB_LIMIT, 1, MAX_GLOB_RESULTS);
  const start =
    typeof args.path === 'string' && args.path
      ? path.relative(ctx.projectRoot, resolveProjectPath(ctx.projectRoot, args.path, { additionalRoots: ctx.additionalRoots }))
      : undefined;

  const listed = await listPaths({
    root: ctx.projectRoot,
    start,
    glob: pattern,
    includeHidden: Boolean(args.include_hidden),
    includeDirs: Boolean(args.include_dirs),
    ignorePatterns: await resolveIgnorePatterns(ctx),
    limit: SORT_CAP,
    signal: ctx.signal,
    backend: ctx.searchBackend,
  });

  const withTimes = await Promise.all(
    listed.paths.map(async (entry) => {
      try {
        const stat = await fs.promises.stat(path.join(ctx.projectRoot, entry.rel));
        return { ...entry, mtimeMs: stat.mtimeMs };
      } catch {
        return { ...entry, mtimeMs: 0 };
      }
    })
  );
  withTimes.sort((a, b) => (b.mtimeMs !== a.mtimeMs ? b.mtimeMs - a.mtimeMs : a.rel.localeCompare(b.rel)));

  const shown = withTimes.slice(0, limit);
  const lines = shown.length
    ? shown.map((entry, idx) => {
        const modified = entry.mtimeMs ? new Date(entry.mtimeMs).toISOString() : 'unknown';
        return `${idx + 1}. ${entry.rel}${entry.isDir ? '/' : ''}  ${modified}`;
      })
    : ['No files matched the requested pattern.'];
  if (withTimes.length > shown.length) lines.push(`… and ${withTimes.length - shown.length} more`);
  if (listed.incomplete) {
    lines.push(
      `[Listing stopped early: ${listed.reason}. Only the first ${listed.paths.length} matches were sorted; narrow the pattern or the path.]`
    );
  }

  return {
    output: lines.join('\n'),
    metadata: { totalMatches: withTimes.length, limit, pattern, incomplete: listed.incomplete, backend: listed.backend },
  };
}

const globSchema: JsonSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description:
        'Gitignore-style glob, for example "src/**/*.ts". A pattern without a slash matches at any depth. Defaults to every file.',
    },
    path: { type: 'string', description: 'Directory under the project root to list instead of the whole project.' },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_GLOB_RESULTS,
      description: `Maximum number of paths to return (1-${MAX_GLOB_RESULTS}). Defaults to ${DEFAULT_GLOB_LIMIT}.`,
    },
    include_hidden: { type: 'boolean', description: 'Include dotfiles and other hidden entries.' },
    include_dirs: { type: 'boolean', description: 'Include directories in the listing. Defaults to files only.' },
  },
  required: [],
  additionalProperties: false,
};

export const GLOB_TOOL: RegisteredTool = {
  name: 'glob',
  description:
    'List paths matching a glob, most recently modified first, honoring .gitignore and the configured ignore patterns.',
  inputSchema: globSchema,
  policy: 'read',
  runner: globRunner,
};
