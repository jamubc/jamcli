import fs from 'fs';
import { createTwoFilesPatch } from 'diff';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { anchorAtLine, type LineAnchor } from './anchors.js';
import { resolveProjectPath } from './paths.js';
import { AmbiguousMatchError, replaceLiteral } from './textEdit.js';

export { AmbiguousMatchError };

/** An anchor the caller read, to be checked against the file before editing. */
export interface AnchorInput {
  line: number;
  anchor: string;
}

/** A single anchor that no longer matches the content at its line. */
export interface AnchorMismatch {
  line: number;
  expected: string;
  actual: string;
}

/**
 * Raised when the caller's anchors no longer describe the file on disk. The
 * edit is not applied and `freshAnchors` carries the current anchors so the
 * caller can retry.
 */
export class StaleAnchorError extends Error {
  readonly path: string;
  readonly mismatches: AnchorMismatch[];
  readonly freshAnchors: LineAnchor[];

  constructor(path: string, mismatches: AnchorMismatch[], freshAnchors: LineAnchor[]) {
    super(
      `Anchors for ${path} are stale: ${mismatches.length} of the anchors read no longer match the file, so it changed since it was read. The edit was not applied. Fresh anchors: ${JSON.stringify(
        freshAnchors
      )}. Re-read the file or retry with these anchors.`
    );
    this.name = 'StaleAnchorError';
    this.path = path;
    this.mismatches = mismatches;
    this.freshAnchors = freshAnchors;
  }
}

function normalizeAnchors(raw: unknown): AnchorInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('edit "anchors" must be an array of { line, anchor } objects.');
  }
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`edit anchor at index ${index} must be a { line, anchor } object.`);
    }
    const { line, anchor } = entry as Record<string, unknown>;
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
      throw new Error(`edit anchor at index ${index} needs a positive integer "line".`);
    }
    if (typeof anchor !== 'string' || !anchor.length) {
      throw new Error(`edit anchor at index ${index} needs a non-empty "anchor" string.`);
    }
    return { line, anchor };
  });
}

/**
 * Find and replace in a file. The match must be unique unless the caller names an
 * occurrence or asks to replace them all: an ambiguous find is rejected with its match
 * count rather than silently replacing the first hit. Replacement text is literal and
 * the file's line endings are preserved.
 *
 * When `anchors` are supplied the caller is asserting which content it read. If
 * any anchor is stale the edit is rejected before anything is written and the
 * current anchors are returned on the error so the caller can re-issue it.
 */
export async function editRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const target = args.path;
  if (typeof target !== 'string' || !target.length) {
    throw new Error('edit requires a "path" parameter.');
  }
  const findString = args.find_string;
  if (typeof findString !== 'string' || !findString.length) {
    throw new Error('edit requires a "find_string" to replace.');
  }
  const replaceString = typeof args.replace_string === 'string' ? args.replace_string : '';

  const absolute = resolveProjectPath(ctx.projectRoot, target);
  const content = await fs.promises.readFile(absolute, 'utf-8');
  const lines = content.split(/\r?\n/);

  const anchors = normalizeAnchors(args.anchors);
  if (anchors.length) {
    const mismatches: AnchorMismatch[] = [];
    for (const { line, anchor } of anchors) {
      const actual = anchorAtLine(lines, line);
      if (actual !== anchor) {
        mismatches.push({ line, expected: anchor, actual });
      }
    }
    if (mismatches.length) {
      const freshAnchors = anchors.map(({ line }) => ({ line, anchor: anchorAtLine(lines, line) }));
      throw new StaleAnchorError(target, mismatches, freshAnchors);
    }
  }

  const result = replaceLiteral(content, findString, replaceString, target, {
    all: args.replace_all === true,
    occurrence: typeof args.occurrence === 'number' ? args.occurrence : undefined,
  });
  await fs.promises.writeFile(absolute, result.content, 'utf-8');

  const { startLine, endLine, replaced } = result;
  const affected = endLine > startLine ? `lines ${startLine}-${endLine}` : `line ${startLine}`;
  const noun = replaced === 1 ? 'occurrence' : 'occurrences';

  return {
    output: `Replaced ${replaced} ${noun} in ${target}. First change at ${affected}.`,
    metadata: {
      path: target,
      replacements: replaced,
      startLine,
      endLine,
      totalLines: result.content.split(/\r?\n/).length,
      diff: createTwoFilesPatch(target, target, content, result.content, '', '', { context: 3 }),
    },
  };
}

const editSchema: JsonSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'File path relative to the project root.' },
    find_string: {
      type: 'string',
      description:
        'Exact snippet to replace. It must match exactly once unless occurrence or replace_all is given, or the edit is rejected.',
    },
    replace_string: { type: 'string', description: 'Replacement text for find_string, inserted literally.' },
    replace_all: { type: 'boolean', description: 'Replace every occurrence of find_string.' },
    occurrence: {
      type: 'integer',
      minimum: 1,
      description: 'Replace only this occurrence of find_string, counted from 1 at the top of the file.',
    },
    anchors: {
      type: 'array',
      description:
        'Anchors read from read_file for the lines being edited. If any no longer match, the edit is rejected and fresh anchors are returned.',
      items: {
        type: 'object',
        properties: {
          line: { type: 'integer', minimum: 1, description: '1-indexed line number the anchor belongs to.' },
          anchor: { type: 'string', description: 'Anchor content returned by read_file for that line.' },
        },
        required: ['line', 'anchor'],
        additionalProperties: false,
      },
    },
  },
  required: ['path', 'find_string'],
  additionalProperties: false,
};

export const EDIT_TOOL: RegisteredTool = {
  name: 'edit',
  description:
    'Find and replace in a file. Rejects an ambiguous match and refuses an edit whose read anchors are stale.',
  inputSchema: editSchema,
  policy: 'write',
  runner: editRunner,
};
