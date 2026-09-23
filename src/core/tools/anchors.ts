import crypto from 'crypto';

/**
 * Length of the hexadecimal anchor emitted for a line. 12 hex characters (48
 * bits) keep collision odds negligible for a single file while staying short
 * enough to read in a tool result.
 */
export const ANCHOR_LENGTH = 12;

/** A line number paired with the anchor of the content read at that line. */
export interface LineAnchor {
  line: number;
  anchor: string;
}

/**
 * Compute the stable anchor for a piece of line content. The anchor is a pure
 * function of the content: it is identical every time the same content is read
 * and changes as soon as the content changes. It deliberately excludes the line
 * number so an unchanged line keeps its anchor even if it moves.
 */
export function lineAnchor(content: string): string {
  return crypto.createHash('sha1').update(content, 'utf8').digest('hex').slice(0, ANCHOR_LENGTH);
}

/** Anchor for a 1-indexed line, or an empty string when the line is out of range. */
export function anchorAtLine(lines: string[], line: number): string {
  if (line < 1 || line > lines.length) return '';
  return lineAnchor(lines[line - 1]);
}

/** Collect anchors for an inclusive 1-indexed line range. */
export function collectAnchors(lines: string[], startLine: number, endLine: number): LineAnchor[] {
  const anchors: LineAnchor[] = [];
  for (let line = startLine; line <= endLine; line += 1) {
    anchors.push({ line, anchor: anchorAtLine(lines, line) });
  }
  return anchors;
}

/**
 * Render one line the way `read_file` returns it. The `line|anchor|content`
 * shape is unambiguous: the line number and anchor never contain `|`.
 */
export function formatAnchoredLine(line: number, anchor: string, content: string): string {
  return `${line}|${anchor}|${content}`;
}
