import { Action } from '../store/index.js';
import type { ToolCall } from '../types/tools.js';
import { SAFE_TOOL_NAMES } from '../types/tools.js';

export interface ParsedIntents {
  pendingActions: Action[];
  toolCalls: ToolCall[];
}

const APPROVAL_ACTIONS = new Set(['edit_file', 'file_edit', 'apply_patch', 'run_shell', 'run_command', 'shell_exec']);
const TOOL_NAME_MAP: Record<string, ToolCall['tool']> = {
  list_files: 'list_files',
  read_file: 'read_file',
  search_code: 'search_code',
};

export class ActionParser {
  static parse(text: string): Action | null {
    const intents = this.extractIntents(text);
    return intents.pendingActions[0] ?? null;
  }

  static extractIntents(text: string): ParsedIntents {
    const results: ParsedIntents = { pendingActions: [], toolCalls: [] };
    const blocks = this.extractJsonBlocks(text);

    for (const payload of blocks) {
      const candidates = this.normalizePayload(payload);
      for (const candidate of candidates) {
        this.handleCandidate(candidate, results);
      }
    }

    return results;
  }

  private static extractJsonBlocks(text: string) {
    const regex = /```json\s*([\s\S]*?)\s*```/gi;
    const payloads: any[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      try {
        payloads.push(JSON.parse(match[1]));
      } catch (error) {
        console.error('Failed to parse JSON action', error);
      }
    }

    return payloads;
  }

  private static normalizePayload(payload: any): any[] {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.actions)) return payload.actions;
    if (Array.isArray(payload.tool_calls)) return payload.tool_calls;
    return [payload];
  }

  private static handleCandidate(candidate: any, results: ParsedIntents) {
    if (!candidate || typeof candidate !== 'object') return;

    const actionName = (candidate.action || candidate.tool || candidate.name || candidate.type || '').toString().toLowerCase();
    const params = candidate.params || candidate.arguments || candidate.input || {};

    if (!actionName) {
      return;
    }

    if (APPROVAL_ACTIONS.has(actionName)) {
      const action = this.buildAction(actionName, params);
      if (action) {
        results.pendingActions.push(action);
      }
      return;
    }

    if (actionName in TOOL_NAME_MAP || SAFE_TOOL_NAMES.includes(actionName as ToolCall['tool'])) {
      const tool = (TOOL_NAME_MAP[actionName] || actionName) as ToolCall['tool'];
      if (SAFE_TOOL_NAMES.includes(tool)) {
        results.toolCalls.push({ tool, params, raw: candidate });
      }
    }
  }

  private static buildAction(actionName: string, params: any): Action | null {
    if (!params) return null;

    if (actionName === 'run_shell' || actionName === 'run_command' || actionName === 'shell_exec') {
      if (!params.command) {
        return null;
      }
      return {
        type: 'shell_exec',
        params: {
          command: params.command,
          cwd: params.cwd || process.cwd(),
        },
        status: 'pending',
      };
    }

    if (actionName === 'apply_patch') {
      if (!params.path || !params.patch) {
        return null;
      }
      return {
        type: 'file_edit',
        params: {
          path: params.path,
          patch: params.patch,
        },
        status: 'pending',
      };
    }

    // Default file edit schema expects find/replace pairs
    if (params.path && params.find_string && params.replace_string) {
      return {
        type: 'file_edit',
        params,
        status: 'pending',
      };
    }

    return null;
  }
}
