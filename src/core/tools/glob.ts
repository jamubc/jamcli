import fg, { Entry } from 'fast-glob';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { resolveIgnorePatterns } from './ignore.js';

const DEFAULT_GLOB_PATTERN = '**/*';
const MAX_GLOB_RESULTS = 200;
const DEFAULT_GLOB_LIMIT = 100;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * List paths matching a glob, most recently modified first, honoring the ignore
 * patterns carried on the context. `list_files` keeps its name-ordering contract;
 * `glob` is the recency-ordered view callers reach for when they want the files
 * they just touched.
 */
export async function globRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const pattern = typeof args.pattern === 'string' && args.pattern ? args.pattern : DEFAULT_GLOB_PATTERN;
  const includeHidden = Boolean(args.include_hidden);
  const includeDirs = args.include_dirs ?? false;
  const limit = clamp(typeof args.limit === 'number' ? args.limit : DEFAULT_GLOB_LIMIT, 1, MAX_GLOB_RESULTS);
  const ignore = await resolveIgnorePatterns(ctx);

  const entries = (await fg(pattern, {
    cwd: ctx.projectRoot,
    dot: includeHidden,
    ignore,
    onlyFiles: !includeDirs,
    objectMode: true,
    stats: true,
  })) as Entry[];

  const sorted = [...entries].sort((a, b) => {
    const aTime = a.stats?.mtimeMs ?? 0;
    const bTime = b.stats?.mtimeMs ?? 0;
    if (bTime !== aTime) return bTime - aTime;
    return a.path.localeCompare(b.path);
  });

  const limited = sorted.slice(0, limit);
  const body = limited.length
    ? limited
        .map((entry, idx) => {
          const relative = entry.path.replace(/\\/g, '/');
          const modified = entry.stats ? new Date(entry.stats.mtimeMs).toISOString() : 'unknown';
          return `${idx + 1}. ${relative}  ${modified}`;
        })
        .join('\n')
    : 'No files matched the requested pattern.';

  const suffix = sorted.length > limited.length ? `\n… and ${sorted.length - limited.length} more` : '';

  return {
    output: `${body}${suffix}`,
    metadata: {
      totalMatches: sorted.length,
      limit,
      pattern,
    },
  };
}

const globSchema: JsonSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'Glob pattern to match, for example "src/**/*.ts". Defaults to every file.',
    },
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
  description: 'List paths matching a glob pattern, ordered by most recently modified and respecting ignore patterns.',
  inputSchema: globSchema,
  policy: 'read',
  runner: globRunner,
};
