import path from 'path';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { resolveIgnorePatterns } from './ignore.js';
import { resolveProjectPath } from './paths.js';
import { formatGrep, grepFiles, type GrepOutputMode } from './search.js';

const DEFAULT_GREP_LIMIT = 100;
const MAX_GREP_LIMIT = 1000;
const MAX_CONTEXT_LINES = 10;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Search file contents with a regular expression. The result mirrors ripgrep's shape:
 * `path:line:text` for a match, `path-line-text` for a context line, and `--` between
 * groups. Ignore files and configured patterns apply, and a result cut short by a limit
 * says so.
 */
export async function grepRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const pattern = args.pattern;
  if (typeof pattern !== 'string' || !pattern.length) {
    throw new Error('grep requires a "pattern" string.');
  }
  const mode: GrepOutputMode = args.output_mode === 'files' || args.output_mode === 'count' ? args.output_mode : 'content';
  const start =
    typeof args.path === 'string' && args.path
      ? path.relative(ctx.projectRoot, resolveProjectPath(ctx.projectRoot, args.path, { additionalRoots: ctx.additionalRoots }))
      : undefined;

  const result = await grepFiles({
    root: ctx.projectRoot,
    start,
    pattern,
    caseSensitive: args.case_sensitive === undefined ? true : Boolean(args.case_sensitive),
    glob: typeof args.glob === 'string' && args.glob ? args.glob : undefined,
    context: clamp(typeof args.context === 'number' ? args.context : 0, 0, MAX_CONTEXT_LINES),
    mode,
    limit: clamp(typeof args.limit === 'number' ? args.limit : DEFAULT_GREP_LIMIT, 1, MAX_GREP_LIMIT),
    includeHidden: Boolean(args.include_hidden),
    ignorePatterns: await resolveIgnorePatterns(ctx),
    signal: ctx.signal,
    backend: ctx.searchBackend,
  });

  return {
    output: formatGrep(result, mode, pattern),
    metadata: {
      pattern,
      matches: result.matchCount,
      files: result.files.length,
      incomplete: result.incomplete,
      backend: result.backend,
    },
  };
}

const grepSchema: JsonSchema = {
  type: 'object',
  properties: {
    pattern: { type: 'string', description: 'Regular expression to search for.' },
    path: { type: 'string', description: 'File or directory under the project root to search. Defaults to the whole project.' },
    glob: {
      type: 'string',
      description: 'Gitignore-style glob limiting which files are searched, for example "*.ts" or "src/**/*.py".',
    },
    case_sensitive: {
      type: 'boolean',
      description: 'Match case. Defaults to true, matching ripgrep; set false for -i behavior.',
    },
    context: {
      type: 'integer',
      minimum: 0,
      maximum: MAX_CONTEXT_LINES,
      description: `Lines of context around each match (0-${MAX_CONTEXT_LINES}). Content mode only.`,
    },
    output_mode: {
      type: 'string',
      enum: ['content', 'files', 'count'],
      description: 'content shows matching lines, files lists matching files, count gives matches per file.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_GREP_LIMIT,
      description: `Maximum matches (content) or files (files, count). Defaults to ${DEFAULT_GREP_LIMIT}.`,
    },
    include_hidden: { type: 'boolean', description: 'Include dotfiles and other hidden entries.' },
  },
  required: ['pattern'],
  additionalProperties: false,
};

export const GREP_TOOL: RegisteredTool = {
  name: 'grep',
  description:
    'Search file contents with a regular expression, honoring .gitignore. Returns matching lines with context, matching files, or counts.',
  inputSchema: grepSchema,
  policy: 'read',
  runner: grepRunner,
};
