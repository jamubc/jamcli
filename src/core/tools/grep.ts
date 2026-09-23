import fs from 'fs-extra';
import path from 'path';
import fg from 'fast-glob';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { resolveIgnorePatterns } from './ignore.js';

const DEFAULT_GREP_GLOB = '**/*';
const DEFAULT_GREP_LIMIT = 50;
const MAX_GREP_MATCHES = 200;
const MAX_GREP_FILES = 400;
const MAX_GREP_FILE_BYTES = 512 * 1024; // 512 KB
const MAX_CONTEXT_LINES = 10;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

interface GrepGroup {
  file: string;
  start: number;
  end: number;
  matches: Set<number>;
  lines: string[];
}

/**
 * Search file contents with a ripgrep-style pattern. The result mirrors
 * ripgrep's default shape: `path:line:text` for a match, `path-line-text` for a
 * context line, and `--` between groups. Case sensitivity, context width, file
 * filtering, and the result cap are all caller-controlled; ignore patterns come
 * from the context.
 */
export async function grepRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const source = args.pattern;
  if (typeof source !== 'string' || !source.length) {
    throw new Error('grep requires a "pattern" string.');
  }

  const caseSensitive = args.case_sensitive === undefined ? true : Boolean(args.case_sensitive);
  let regex: RegExp;
  try {
    regex = new RegExp(source, caseSensitive ? '' : 'i');
  } catch (error: any) {
    throw new Error(`grep pattern is not a valid regular expression: ${error?.message || error}`);
  }

  const context = clamp(typeof args.context === 'number' ? args.context : 0, 0, MAX_CONTEXT_LINES);
  const pattern = typeof args.glob === 'string' && args.glob ? args.glob : DEFAULT_GREP_GLOB;
  const limit = clamp(typeof args.limit === 'number' ? args.limit : DEFAULT_GREP_LIMIT, 1, MAX_GREP_MATCHES);
  const ignore = await resolveIgnorePatterns(ctx);

  const files = await fg(pattern, {
    cwd: ctx.projectRoot,
    dot: Boolean(args.include_hidden),
    ignore,
    onlyFiles: true,
    absolute: true,
  });
  const limitedFiles = files.slice(0, MAX_GREP_FILES);

  const groups: GrepGroup[] = [];
  let matchCount = 0;
  let filesScanned = 0;

  for (const file of limitedFiles) {
    if (matchCount >= limit) break;
    const stats = await fs.stat(file);
    if (stats.size > MAX_GREP_FILE_BYTES) continue;
    filesScanned += 1;

    const relPath = (path.relative(ctx.projectRoot, file) || path.basename(file)).replace(/\\/g, '/');
    const lines = (await fs.readFile(file, 'utf-8')).split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      if (!regex.test(lines[i])) continue;

      matchCount += 1;
      const start = Math.max(0, i - context);
      const end = Math.min(lines.length - 1, i + context);

      const previous = groups[groups.length - 1];
      if (previous && previous.file === relPath && start <= previous.end + 1) {
        previous.end = Math.max(previous.end, end);
        previous.matches.add(i);
      } else {
        groups.push({ file: relPath, start, end, matches: new Set<number>([i]), lines });
      }

      if (matchCount >= limit) break;
    }
  }

  if (!matchCount) {
    return {
      output: `No matches for /${source}/ across ${filesScanned} files.`,
      metadata: { pattern, filesScanned, matches: 0 },
    };
  }

  const body = groups
    .map((group) => {
      const rendered: string[] = [];
      for (let i = group.start; i <= group.end; i += 1) {
        const separator = group.matches.has(i) ? ':' : '-';
        rendered.push(`${group.file}${separator}${i + 1}${separator}${group.lines[i]}`);
      }
      return rendered.join('\n');
    })
    .join('\n--\n');

  return {
    output: body,
    metadata: {
      pattern,
      filesScanned,
      matches: matchCount,
    },
  };
}

const grepSchema: JsonSchema = {
  type: 'object',
  properties: {
    pattern: { type: 'string', description: 'Regular expression source to search for.' },
    case_sensitive: {
      type: 'boolean',
      description: 'Match case. Defaults to true, matching ripgrep; set false for -i behavior.',
    },
    context: {
      type: 'integer',
      minimum: 0,
      maximum: MAX_CONTEXT_LINES,
      description: `Number of surrounding lines to include (0-${MAX_CONTEXT_LINES}). Defaults to 0.`,
    },
    glob: {
      type: 'string',
      description: 'Glob pattern limiting which files are searched. Defaults to every file.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_GREP_MATCHES,
      description: `Maximum number of matches to return (1-${MAX_GREP_MATCHES}). Defaults to ${DEFAULT_GREP_LIMIT}.`,
    },
    include_hidden: { type: 'boolean', description: 'Include dotfiles and other hidden entries.' },
  },
  required: ['pattern'],
  additionalProperties: false,
};

export const GREP_TOOL: RegisteredTool = {
  name: 'grep',
  description: 'Search file contents with a pattern, returning matches with file, line, and surrounding context.',
  inputSchema: grepSchema,
  policy: 'read',
  runner: grepRunner,
};
