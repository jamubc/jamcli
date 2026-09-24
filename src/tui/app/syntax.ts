import { RGBA, SyntaxStyle, pathToFiletype } from '@opentui/core';

/** Token colors for Markdown, code, and diffs. The colors decorate; nothing depends on them. */
export function createSyntaxStyle(): SyntaxStyle {
  const hex = (value: string) => RGBA.fromHex(value);
  return SyntaxStyle.fromStyles({
    default: { fg: RGBA.defaultForeground() },
    'markup.heading': { fg: hex('#7aa2f7'), bold: true },
    'markup.strong': { bold: true },
    'markup.italic': { italic: true },
    'markup.list': { fg: hex('#e0af68') },
    'markup.raw': { fg: hex('#9ece6a') },
    'markup.link': { fg: hex('#7dcfff'), underline: true },
    keyword: { fg: hex('#bb9af7'), bold: true },
    string: { fg: hex('#9ece6a') },
    comment: { fg: hex('#7a7f8c'), italic: true },
    number: { fg: hex('#ff9e64') },
    boolean: { fg: hex('#ff9e64') },
    constant: { fg: hex('#ff9e64') },
    function: { fg: hex('#7aa2f7') },
    'function.call': { fg: hex('#7aa2f7') },
    type: { fg: hex('#2ac3de') },
    property: { fg: hex('#73daca') },
    operator: { fg: hex('#89ddff') },
  });
}

/** The language a file's diff is highlighted as, when its name says. */
export const filetypeOf = (file: string | undefined): string | undefined => (file ? pathToFiletype(file) : undefined);
