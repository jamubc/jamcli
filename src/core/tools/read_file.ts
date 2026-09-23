import path from 'path';
import { FileSystemService } from '../../services/FileSystemService.js';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { collectAnchors, formatAnchoredLine } from './anchors.js';
import { resolveProjectPath } from './paths.js';

const DEFAULT_WINDOW = 200;
const MAX_READ_BYTES = 64 * 1024; // 64 KB

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Read a file range. Each returned line carries a stable content anchor so a
 * later `edit` can prove it is acting on the bytes it read. The path, line
 * range, and 64 KB truncation behavior are unchanged from the plain reader.
 */
export async function readFileRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const target = args.path || args.file;
  if (!target || typeof target !== 'string') {
    throw new Error('read_file requires a "path" parameter.');
  }

  const absolute = resolveProjectPath(ctx.projectRoot, target);
  const content = await new FileSystemService().readFile(absolute);
  const lines = content.split(/\r?\n/);
  const startLine = clamp(typeof args.start_line === 'number' ? args.start_line : 1, 1, lines.length);
  const endLine = clamp(
    typeof args.end_line === 'number' ? args.end_line : startLine + DEFAULT_WINDOW - 1,
    startLine,
    lines.length
  );

  const anchors = collectAnchors(lines, startLine, endLine);
  let joined = anchors
    .map(({ line, anchor }) => formatAnchoredLine(line, anchor, lines[line - 1]))
    .join('\n');

  let truncated = false;
  if (joined.length > MAX_READ_BYTES) {
    joined = joined.slice(0, MAX_READ_BYTES) + '\n… <truncated>';
    truncated = true;
  }

  return {
    output: joined,
    metadata: {
      path: path.relative(ctx.projectRoot, absolute) || '.',
      startLine,
      endLine,
      truncated,
      anchors,
    },
  };
}

const readFileSchema: JsonSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'File path relative to the project root.' },
    start_line: { type: 'integer', minimum: 1, description: 'First line to return, 1-indexed. Defaults to 1.' },
    end_line: { type: 'integer', minimum: 1, description: 'Last line to return, inclusive.' },
  },
  required: ['path'],
  additionalProperties: false,
};

export const READ_FILE_TOOL: RegisteredTool = {
  name: 'read_file',
  description: 'Read file content with an optional line range, returning a stable content anchor per line.',
  inputSchema: readFileSchema,
  policy: 'read',
  runner: readFileRunner,
};
