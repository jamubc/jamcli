import fs from 'fs';
import { sessionFileFor } from '../../core/transcript/index.js';
import type { CommandContext, SessionChoice } from '../types.js';

/** This session, to open again; one with no turns has no file yet, so a new one stands in. */
export const thisSession = (ctx: CommandContext): SessionChoice =>
  fs.existsSync(sessionFileFor(ctx.projectRoot, ctx.runtime.sessionId)) ? { sessionId: ctx.runtime.sessionId, reopen: true } : { reopen: true };

/**
 * Reopen this session, so a change to the files it was built from applies. A command that
 * saves configuration calls this; it lives here, and not in the registry that assembles the
 * commands, so a command can reach it without importing the registry.
 */
export async function reopen(ctx: CommandContext): Promise<void> {
  // Where the session is not replaced in place, a saved change takes effect in the next one, which is not a failure.
  if (!ctx.opensSessions) return ctx.notice('info', 'Saved. It applies to new sessions.');
  const error = await ctx.openSession(thisSession(ctx));
  if (error) ctx.notice('warn', `Saved, but this session could not reopen with it: ${error}`);
  else ctx.notice('info', 'Applied to this session.');
}