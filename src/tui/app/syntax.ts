import { RGBA, SyntaxStyle, pathToFiletype } from '@opentui/core';
import type { Theme } from './theme.js';

/** Token styles for Markdown, code, and diffs, in the theme's colors. The colors decorate; nothing depends on them. */
export function createSyntaxStyle(theme: Theme): SyntaxStyle {
  const fg = (value: string | undefined) => (value ? { fg: RGBA.fromHex(value) } : {});
  const { tokens } = theme;
  return SyntaxStyle.fromStyles({
    default: { fg: RGBA.defaultForeground() },
    'markup.heading': { ...fg(tokens.heading), bold: true },
    'markup.strong': { bold: true },
    'markup.italic': { italic: true },
    'markup.list': fg(tokens.list),
    'markup.raw': fg(tokens.raw),
    'markup.link': { ...fg(tokens.link), underline: true },
    keyword: { ...fg(tokens.keyword), bold: true },
    string: fg(tokens.string),
    comment: { ...fg(tokens.comment), italic: true },
    number: fg(tokens.number),
    boolean: fg(tokens.number),
    constant: fg(tokens.number),
    function: fg(tokens.func),
    'function.call': fg(tokens.func),
    type: fg(tokens.type),
    property: fg(tokens.property),
    operator: fg(tokens.operator),
  });
}

/** The language a file's diff is highlighted as, when its name says. */
export const filetypeOf = (file: string | undefined): string | undefined => (file ? pathToFiletype(file) : undefined);
