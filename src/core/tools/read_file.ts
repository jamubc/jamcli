import fs from 'fs';
import path from 'path';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { collectAnchors, formatAnchoredLine } from './anchors.js';
import { resolveProjectPath } from './paths.js';

const DEFAULT_LINE_WINDOW = 2_000;
const MAX_LINE_CHARS = 2_000;
const DEFAULT_OUTPUT_CHARS = 30_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8_000;

/**
 * Read a window of a text file. Each returned line carries its number and a stable
 * content anchor, so a later `edit` can prove it is changing the bytes that were read.
 * A long line is cut for display but anchored on its full content. When the window or
 * the output budget ends before the file does, the result says where to continue.
 */
export async function readFileRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const target = args.path || args.file;
  if (!target || typeof target !== 'string') {
    throw new Error('read_file requires a "path" parameter.');
  }

  const absolute = resolveProjectPath(ctx.projectRoot, target, { additionalRoots: ctx.additionalRoots });
  const rel = path.relative(ctx.projectRoot, absolute) || '.';
  const stat = await fs.promises.stat(absolute);
  if (stat.isDirectory()) {
    throw new Error(`${rel} is a directory; use glob to list it.`);
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`${rel} is ${stat.size} bytes, too large to read whole; use grep to find what you need in it.`);
  }
  const buffer = await fs.promises.readFile(absolute);
  if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    return {
      output: `${rel} is a binary file (${stat.size} bytes); read_file shows text only.`,
      metadata: { path: rel, binary: true, size: stat.size },
    };
  }

  const content = buffer.toString('utf8');
  if (!content.length) {
    return { output: `${rel} is empty.`, metadata: { path: rel, startLine: 0, endLine: 0, totalLines: 0, anchors: [] } };
  }
  const lines = content.split(/\r?\n/);
  if (content.endsWith('\n')) lines.pop();
  const totalLines = lines.length;

  const requestedStart = typeof args.offset === 'number' ? args.offset : typeof args.start_line === 'number' ? args.start_line : 1;
  const startLine = Math.min(Math.max(requestedStart, 1), Math.max(totalLines, 1));
  const window = typeof args.limit === 'number' && args.limit > 0 ? args.limit : DEFAULT_LINE_WINDOW;
  const requestedEnd = typeof args.end_line === 'number' ? args.end_line : startLine + window - 1;
  const windowEnd = Math.min(Math.max(requestedEnd, startLine), totalLines);

  const budget = ctx.maxOutputChars ?? DEFAULT_OUTPUT_CHARS;
  const rendered: string[] = [];
  let used = 0;
  let endLine = startLine - 1;
  let cutLines = 0;
  for (const { line, anchor } of collectAnchors(lines, startLine, windowEnd)) {
    const full = lines[line - 1];
    const shown = full.length > MAX_LINE_CHARS ? `${full.slice(0, MAX_LINE_CHARS)}… [line cut at ${MAX_LINE_CHARS} characters]` : full;
    if (shown !== full) cutLines += 1;
    const entry = formatAnchoredLine(line, anchor, shown);
    if (rendered.length && used + entry.length + 1 > budget) break;
    rendered.push(entry);
    used += entry.length + 1;
    endLine = line;
  }

  const notes: string[] = [];
  if (endLine < totalLines) {
    notes.push(`[Showing lines ${startLine}-${endLine} of ${totalLines}. Continue with offset ${endLine + 1}.]`);
  }
  if (cutLines) notes.push(`[${cutLines} long line${cutLines === 1 ? ' was' : 's were'} cut for display.]`);

  return {
    output: [rendered.join('\n'), ...notes].join('\n'),
    metadata: {
      path: rel,
      startLine,
      endLine,
      totalLines,
      truncated: endLine < totalLines,
      anchors: collectAnchors(lines, startLine, endLine),
    },
  };
}

const readFileSchema: JsonSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'File path relative to the project root.' },
    offset: { type: 'integer', minimum: 1, description: 'First line to return, 1-indexed. Defaults to 1.' },
    limit: {
      type: 'integer',
      minimum: 1,
      description: `Number of lines to return. Defaults to ${DEFAULT_LINE_WINDOW}.`,
    },
    start_line: { type: 'integer', minimum: 1, description: 'Same as offset; kept for older callers.' },
    end_line: { type: 'integer', minimum: 1, description: 'Last line to return, inclusive.' },
  },
  required: ['path'],
  additionalProperties: false,
};

export const READ_FILE_TOOL: RegisteredTool = {
  name: 'read_file',
  description:
    'Read a text file with line numbers and a stable anchor per line. Large files are read in windows; the result says where to continue.',
  inputSchema: readFileSchema,
  policy: 'read',
  runner: readFileRunner,
};
