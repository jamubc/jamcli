import path from 'path';
import { ConfigService } from './ConfigService.js';
import { executeTool } from '../core/tools/index.js';
import type { ToolCall, ToolResult } from '../types/tools.js';

interface ToolServiceOptions {
  projectRoot?: string;
  configService?: ConfigService;
}

/**
 * Thin adapter over the core tool registry. It keeps the legacy ToolCall based
 * surface for the TUI while every dispatch, schema check, and runner lives in
 * src/core/tools/registry.ts.
 */
export class ToolService {
  private projectRoot: string;
  private configService: ConfigService;
  private ignorePatterns?: string[];

  constructor(options: ToolServiceOptions = {}) {
    this.projectRoot = path.resolve(options.projectRoot || process.cwd());
    this.configService = options.configService || new ConfigService(this.projectRoot);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const ignorePatterns = await this.getIgnorePatterns();
    const result = await executeTool(call.tool, call.params ?? {}, {
      projectRoot: this.projectRoot,
      ignorePatterns,
    });

    return {
      tool: call.tool,
      success: result.success,
      output: result.output,
      durationMs: result.durationMs,
      metadata: result.metadata,
    };
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
}
