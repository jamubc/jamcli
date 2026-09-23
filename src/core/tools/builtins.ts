import fs from 'fs-extra';
import path from 'path';
import fg, { Entry } from 'fast-glob';
import { ConfigService } from '../../services/ConfigService.js';
import { FileSystemService } from '../../services/FileSystemService.js';
import { ExecutionService } from '../../services/ExecutionService.js';
import { TOOL_DEFINITIONS } from '../../types/tools.js';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { countOccurrences, resolveProjectPath } from './paths.js';

const DEFAULT_LIST_PATTERN = '**/*';
const DEFAULT_CODE_PATTERN =
  '**/*.{ts,tsx,js,jsx,json,md,py,rb,rs,go,java,cs,php,sh,sql,html,css,scss,c,cpp,h,kt,swift,yml,yaml}';
const MAX_LIST_RESULTS = 200;
const MAX_READ_BYTES = 64 * 1024; // 64 KB
const MAX_SEARCH_MATCHES = 40;
const MAX_SEARCH_FILES = 400;
const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB
const FALLBACK_IGNORE = ['node_modules/**', 'dist/**'];

const ignoreCache = new Map<string, string[]>();

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ensureFlags = (flags: string, enforceGlobal = true) => {
  let result = flags || '';
  if (enforceGlobal && !result.includes('g')) {
    result += 'g';
  }
  return result;
};

async function resolveIgnorePatterns(ctx: ToolContext): Promise<string[]> {
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

async function listFiles(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const pattern = typeof args.pattern === 'string' && args.pattern ? args.pattern : DEFAULT_LIST_PATTERN;
  const includeHidden = Boolean(args.include_hidden);
  const includeDirs = args.include_dirs ?? false;
  const limit = clamp(typeof args.limit === 'number' ? args.limit : 50, 1, MAX_LIST_RESULTS);
  const ignore = await resolveIgnorePatterns(ctx);

  const entries = await fg(pattern, {
    cwd: ctx.projectRoot,
    dot: includeHidden,
    ignore,
    objectMode: true,
    stats: false,
    onlyFiles: !includeDirs,
  });

  const filtered: string[] = [];
  for (const entry of entries as Entry[]) {
    if (!includeDirs && entry.dirent?.isDirectory()) {
      continue;
    }
    if (filtered.length >= limit) break;
    filtered.push(entry.path.replace(/\\/g, '/'));
  }

  const hasMore = entries.length > filtered.length;
  const body = filtered.length
    ? filtered.map((file, idx) => `${idx + 1}. ${file}`).join('\n')
    : 'No files matched the requested pattern.';

  const suffix = hasMore ? `\n… and ${entries.length - filtered.length} more` : '';

  return {
    output: `${body}${suffix}`,
    metadata: {
      totalMatches: entries.length,
      limit,
      pattern,
    },
  };
}

async function readFile(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const target = args.path || args.file;
  if (!target || typeof target !== 'string') {
    throw new Error('read_file requires a "path" parameter.');
  }

  const absolute = resolveProjectPath(ctx.projectRoot, target);
  const content = await new FileSystemService().readFile(absolute);
  const lines = content.split(/\r?\n/);
  const startLine = clamp(typeof args.start_line === 'number' ? args.start_line : 1, 1, lines.length);
  const endLine = clamp(
    typeof args.end_line === 'number' ? args.end_line : startLine + 200 - 1,
    startLine,
    lines.length
  );
  const snippet = lines.slice(startLine - 1, endLine);

  let joined = snippet.map((line, idx) => `${startLine + idx}: ${line}`).join('\n');

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
    },
  };
}

async function searchCode(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const query: string | undefined = args.query;
  const regexParam = args.regex;

  if ((!query || typeof query !== 'string') && (!regexParam || typeof regexParam.pattern !== 'string')) {
    throw new Error('search_code requires a "query" string or "regex" pattern.');
  }

  const regex = regexParam
    ? new RegExp(regexParam.pattern, ensureFlags(regexParam.flags || 'gi'))
    : new RegExp(escapeRegex(query as string), ensureFlags(args.case_sensitive ? 'g' : 'gi'));

  const pattern = typeof args.pattern === 'string' && args.pattern ? args.pattern : DEFAULT_CODE_PATTERN;
  const ignore = await resolveIgnorePatterns(ctx);
  const files = await fg(pattern, {
    cwd: ctx.projectRoot,
    dot: Boolean(args.include_hidden),
    ignore,
    onlyFiles: true,
    absolute: true,
  });

  const limit = clamp(typeof args.limit === 'number' ? args.limit : MAX_SEARCH_MATCHES, 1, MAX_SEARCH_MATCHES);
  const limitedFiles = files.slice(0, MAX_SEARCH_FILES);
  const matches: { file: string; line: number; text: string }[] = [];
  for (const file of limitedFiles) {
    const relPath = path.relative(ctx.projectRoot, file) || path.basename(file);
    const stats = await fs.stat(file);
    if (stats.size > MAX_FILE_SIZE_BYTES) continue;
    const content = await fs.readFile(file, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      regex.lastIndex = 0;
      if (regex.test(line)) {
        matches.push({ file: relPath.replace(/\\/g, '/'), line: i + 1, text: line.trim() });
        if (matches.length >= limit) {
          break;
        }
      }
    }
    if (matches.length >= limit) {
      break;
    }
  }

  if (!matches.length) {
    return {
      output: `No matches for ${regexParam ? `/${regexParam.pattern}/` : `"${query}"`} across ${limitedFiles.length} files.`,
      metadata: { pattern, filesScanned: limitedFiles.length, matches: 0 },
    };
  }

  const body = matches.map((match) => `${match.file}:${match.line}\n  ${match.text}`).join('\n\n');

  return {
    output: body,
    metadata: {
      matches: matches.length,
      pattern,
      filesScanned: limitedFiles.length,
    },
  };
}

async function applyPatch(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const target = args.path;
  if (typeof target !== 'string' || !target.length) {
    throw new Error('apply_patch requires a "path" parameter.');
  }

  // Resolve once so the escape check runs before any file is touched, then hand
  // an absolute path to FileSystemService so it cannot re-anchor somewhere else.
  const absolute = resolveProjectPath(ctx.projectRoot, target);
  const fileSystemService = new FileSystemService();

  if (typeof args.patch === 'string' && args.patch.length) {
    await fileSystemService.applyUnifiedPatch(absolute, args.patch);
    return {
      output: `Applied patch to ${target}.`,
      metadata: { path: target, replacements: 1 },
    };
  }

  const findString = args.find_string;
  if (typeof findString !== 'string' || !findString.length) {
    throw new Error('apply_patch requires either a "patch" string or a "find_string" to replace.');
  }
  const replaceString = typeof args.replace_string === 'string' ? args.replace_string : '';

  const content = await fileSystemService.readFile(absolute);
  const occurrences = countOccurrences(content, findString);
  if (occurrences === 0) {
    throw new Error(`find_string was not found in ${target}.`);
  }
  if (occurrences > 1) {
    throw new Error(
      `find_string matches ${occurrences} locations in ${target}; provide a unique snippet so the edit is unambiguous.`
    );
  }

  await fileSystemService.applyEdit(absolute, findString, replaceString);
  return {
    output: `Replaced 1 occurrence in ${target}.`,
    metadata: { path: target, replacements: 1 },
  };
}

async function runCommand(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const command = args.command;
  if (typeof command !== 'string' || !command.length) {
    throw new Error('run_command requires a "command" parameter.');
  }

  const cwd =
    typeof args.cwd === 'string' && args.cwd.length
      ? resolveProjectPath(ctx.projectRoot, args.cwd)
      : ctx.projectRoot;

  const output = await new ExecutionService().runShell(command, cwd);
  return { output, metadata: { command, cwd } };
}

const listFilesSchema: JsonSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'Glob pattern to match, for example "src/**/*.ts". Defaults to every file.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_LIST_RESULTS,
      description: `Maximum number of paths to return (1-${MAX_LIST_RESULTS}). Defaults to 50.`,
    },
    include_hidden: { type: 'boolean', description: 'Include dotfiles and other hidden entries.' },
    include_dirs: { type: 'boolean', description: 'Include directories in the listing. Defaults to files only.' },
  },
  required: [],
  additionalProperties: false,
};

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

const searchCodeSchema: JsonSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Literal text to search for. Escaped before matching.' },
    regex: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression source.' },
        flags: { type: 'string', description: 'Regular expression flags, for example "gi".' },
      },
      required: ['pattern'],
      additionalProperties: false,
      description: 'A regular expression to match instead of a literal query.',
    },
    pattern: {
      type: 'string',
      description: 'Glob pattern limiting which files are scanned. Defaults to common source extensions.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_SEARCH_MATCHES,
      description: `Maximum number of matches to return (1-${MAX_SEARCH_MATCHES}).`,
    },
    include_hidden: { type: 'boolean', description: 'Include dotfiles and other hidden entries.' },
    case_sensitive: { type: 'boolean', description: 'Match case when only a literal query is provided.' },
  },
  required: [],
  additionalProperties: false,
};

const applyPatchSchema: JsonSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'File path relative to the project root.' },
    patch: { type: 'string', description: 'Unified diff to apply to the file.' },
    find_string: {
      type: 'string',
      description: 'Exact snippet to replace. It must match exactly once or the edit is rejected.',
    },
    replace_string: { type: 'string', description: 'Replacement text for find_string.' },
  },
  required: ['path'],
  additionalProperties: false,
};

const runCommandSchema: JsonSchema = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'Shell command to execute.' },
    cwd: { type: 'string', description: 'Working directory under the project root. Defaults to the project root.' },
  },
  required: ['command'],
  additionalProperties: false,
};

export const BUILTIN_TOOLS: RegisteredTool[] = [
  {
    name: 'list_files',
    description: TOOL_DEFINITIONS.list_files.description,
    inputSchema: listFilesSchema,
    policy: 'read',
    runner: listFiles,
  },
  {
    name: 'read_file',
    description: TOOL_DEFINITIONS.read_file.description,
    inputSchema: readFileSchema,
    policy: 'read',
    runner: readFile,
  },
  {
    name: 'search_code',
    description: TOOL_DEFINITIONS.search_code.description,
    inputSchema: searchCodeSchema,
    policy: 'read',
    runner: searchCode,
  },
  {
    name: 'apply_patch',
    description: TOOL_DEFINITIONS.apply_patch.description,
    inputSchema: applyPatchSchema,
    policy: 'write',
    runner: applyPatch,
  },
  {
    name: 'run_command',
    description: TOOL_DEFINITIONS.run_command.description,
    inputSchema: runCommandSchema,
    policy: 'execute',
    runner: runCommand,
  },
];

export function registerBuiltinTools(registry: { register(tool: RegisteredTool): void }): void {
  for (const tool of BUILTIN_TOOLS) {
    registry.register(tool);
  }
}
