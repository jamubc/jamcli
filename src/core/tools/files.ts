import fs from 'fs';
import type { ToolContext } from '../../types/tools.js';

/**
 * A file's text as the session sees it. In an editor that lends its files, that is the
 * editor's copy, unsaved changes included; the disk answers when the editor cannot.
 */
export async function readText(ctx: ToolContext, absolute: string): Promise<string> {
  if (ctx.editor?.readText) {
    try {
      return await ctx.editor.readText(absolute);
    } catch {
      // The editor could not read it; the disk may.
    }
  }
  return fs.promises.readFile(absolute, 'utf-8');
}

/** Write a file's text: through the editor when it lends its files, so an open buffer shows it, else to disk. */
export async function writeText(ctx: ToolContext, absolute: string, content: string): Promise<void> {
  if (ctx.editor?.writeText) await ctx.editor.writeText(absolute, content);
  else await fs.promises.writeFile(absolute, content, 'utf-8');
}
