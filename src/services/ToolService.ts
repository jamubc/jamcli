import fs from 'fs-extra';
import path from 'path';
import fg, { Entry } from 'fast-glob';
import { ConfigService } from './ConfigService.js';
import { FileSystemService } from './FileSystemService.js';
import type { ToolCall, ToolResult, ToolName } from '../types/tools.js';

const DEFAULT_LIST_PATTERN = '**/*';
const DEFAULT_CODE_PATTERN = '**/*.{ts,tsx,js,jsx,json,md,py,rb,rs,go,java,cs,php,sh,sql,html,css,scss,c,cpp,h,kt,swift,yml,yaml}';
const MAX_LIST_RESULTS = 200;
const MAX_READ_BYTES = 64 * 1024; // 64 KB
const MAX_SEARCH_MATCHES = 40;
const MAX_SEARCH_FILES = 400;
const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ensureFlags = (flags: string, enforceGlobal = true) => {
  let result = flags || '';
  if (enforceGlobal && !result.includes('g')) {
    result += 'g';
  }
  return result;
};

interface ToolServiceOptions {
  projectRoot?: string;
  configService?: ConfigService;
}

export class ToolService {
  private projectRoot: string;
  private configService: ConfigService;
  private fileSystemService: FileSystemService;
  private ignorePatterns?: string[];

  constructor(options: ToolServiceOptions = {}) {
    this.projectRoot = path.resolve(options.projectRoot || process.cwd());
    this.configService = options.configService || new ConfigService(this.projectRoot);
    this.fileSystemService = new FileSystemService();
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    switch (call.tool) {
      case 'list_files': {
        const output = await this.listFiles(call.params);
        return this.toResult(call.tool, start, output.output, output.metadata);
      }
      case 'read_file': {
        const output = await this.readFile(call.params);
        return this.toResult(call.tool, start, output.output, output.metadata);
      }
      case 'search_code': {
        const output = await this.searchCode(call.params);
        return this.toResult(call.tool, start, output.output, output.metadata);
      }
      default:
        throw new Error(`${call.tool} requires manual approval or is not implemented in ToolService.`);
    }
  }

  private async listFiles(params: Record<string, any>) {
    const pattern = params.pattern || DEFAULT_LIST_PATTERN;
    const includeHidden = Boolean(params.include_hidden);
    const includeDirs = params.include_dirs ?? false;
    const limit = clamp(params.limit ?? 50, 1, MAX_LIST_RESULTS);
    const ignore = await this.getIgnorePatterns();

    const entries = await fg(pattern, {
      cwd: this.projectRoot,
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

  private async readFile(params: Record<string, any>) {
    const target = params.path || params.file;
    if (!target || typeof target !== 'string') {
      throw new Error('read_file requires a "path" parameter.');
    }

    const absolute = this.resolvePath(target);
    const content = await this.fileSystemService.readFile(absolute);
    const lines = content.split(/\r?\n/);
    const startLine = clamp(params.start_line ?? 1, 1, lines.length);
    const endLine = clamp(params.end_line ?? startLine + 200 - 1, startLine, lines.length);
    const snippet = lines.slice(startLine - 1, endLine);

    let joined = snippet
      .map((line, idx) => `${startLine + idx}: ${line}`)
      .join('\n');

    let truncated = false;
    if (joined.length > MAX_READ_BYTES) {
      joined = joined.slice(0, MAX_READ_BYTES) + '\n… <truncated>';
      truncated = true;
    }

    return {
      output: joined,
      metadata: {
        path: path.relative(this.projectRoot, absolute) || '.',
        startLine,
        endLine,
        truncated,
      },
    };
  }

  private async searchCode(params: Record<string, any>) {
    const query: string | undefined = params.query;
    const regexParam = params.regex;

    if ((!query || typeof query !== 'string') && (!regexParam || typeof regexParam.pattern !== 'string')) {
      throw new Error('search_code requires a "query" string or "regex" pattern.');
    }

    const regex = regexParam
      ? new RegExp(regexParam.pattern, ensureFlags(regexParam.flags || 'gi'))
      : new RegExp(escapeRegex(query as string), ensureFlags(params.case_sensitive ? 'g' : 'gi'));

    const pattern = params.pattern || DEFAULT_CODE_PATTERN;
    const ignore = await this.getIgnorePatterns();
    const files = await fg(pattern, {
      cwd: this.projectRoot,
      dot: Boolean(params.include_hidden),
      ignore,
      onlyFiles: true,
      absolute: true,
    });

    const limit = clamp(params.limit ?? MAX_SEARCH_MATCHES, 1, MAX_SEARCH_MATCHES);
    const limitedFiles = files.slice(0, MAX_SEARCH_FILES);
    const matches: { file: string; line: number; text: string }[] = [];
    for (const file of limitedFiles) {
      const relPath = path.relative(this.projectRoot, file) || path.basename(file);
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

    const body = matches
      .map((match) => `${match.file}:${match.line}\n  ${match.text}`)
      .join('\n\n');

    return {
      output: body,
      metadata: {
        matches: matches.length,
        pattern,
        filesScanned: limitedFiles.length,
      },
    };
  }

  private resolvePath(target: string) {
    const absolute = path.resolve(this.projectRoot, target);
    const rootWithSep = this.projectRoot.endsWith(path.sep)
      ? this.projectRoot
      : `${this.projectRoot}${path.sep}`;
    if (absolute !== this.projectRoot && !absolute.startsWith(rootWithSep)) {
      throw new Error(`Path ${target} escapes the project root.`);
    }
    return absolute;
  }

  private async getIgnorePatterns() {
    if (!this.ignorePatterns) {
      try {
        const mcpConfig = await this.configService.getMcpConfig();
        this.ignorePatterns = mcpConfig.ignore_patterns || [];
      } catch (error) {
        console.error('Failed to load MCP config, falling back to defaults.', error);
        this.ignorePatterns = ['node_modules/**', 'dist/**'];
      }
    }
    return this.ignorePatterns;
  }

  private toResult(tool: ToolName, start: number, output: string, metadata?: Record<string, any>): ToolResult {
    return {
      tool,
      success: true,
      output,
      durationMs: Date.now() - start,
      metadata,
    };
  }
}
