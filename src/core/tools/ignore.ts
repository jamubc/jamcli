import { loadConfig } from '../config/load.js';
import type { ToolContext } from '../../types/tools.js';

/** Patterns used when no project configuration can be read. */
export const FALLBACK_IGNORE = ['node_modules/**', 'dist/**'];

/** Patterns used when `mcp.json` names none, as the legacy configuration service gave. */
export const DEFAULT_IGNORE = ['node_modules/**', 'dist/**', '*.lock'];

const ignoreCache = new Map<string, string[]>();

/**
 * Resolve the ignore patterns a listing or search must respect. A caller can
 * pass patterns directly on the context, in which case they win. Otherwise the
 * project's `mcp.json` ignore patterns are read once and cached per root.
 */
export async function resolveIgnorePatterns(ctx: ToolContext): Promise<string[]> {
  if (Array.isArray(ctx.ignorePatterns)) return ctx.ignorePatterns;
  const cached = ignoreCache.get(ctx.projectRoot);
  if (cached) return cached;

  let patterns: string[];
  try {
    patterns = loadConfig({ projectRoot: ctx.projectRoot }).mcp.ignore_patterns ?? DEFAULT_IGNORE;
  } catch {
    patterns = FALLBACK_IGNORE;
  }
  ignoreCache.set(ctx.projectRoot, patterns);
  return patterns;
}
