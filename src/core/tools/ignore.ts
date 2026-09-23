import { ConfigService } from '../../services/ConfigService.js';
import type { ToolContext } from '../../types/tools.js';

/** Patterns used when no project configuration can be read. */
export const FALLBACK_IGNORE = ['node_modules/**', 'dist/**'];

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
    const configService = new ConfigService(ctx.projectRoot);
    const mcpConfig = await configService.getMcpConfig();
    patterns = mcpConfig.ignore_patterns || FALLBACK_IGNORE;
  } catch {
    patterns = FALLBACK_IGNORE;
  }
  ignoreCache.set(ctx.projectRoot, patterns);
  return patterns;
}
