import fs from 'fs';
import path from 'path';
import { createTwoFilesPatch } from 'diff';
import type { ApprovalPreview, ApprovalRequest, PolicyClass, ToolCall } from './types.js';
import { replaceLiteral } from './tools/textEdit.js';
import { analyzeCommand } from './permissions/command.js';
import { patchPaths } from './permissions/subjects.js';

/**
 * Builds what a surface shows when a tool call needs a decision: one line naming the
 * action, a preview of its effect, and patterns a grant could remember. Previews are
 * computed without writing anything.
 */

const MAX_PREVIEW_CHARS = 20_000;
const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text);

const argString = (call: ToolCall, key: string): string | undefined => {
  const value = call.arguments?.[key];
  return typeof value === 'string' && value.length ? value : undefined;
};

/** One line naming the action, such as `run_command npm test`. */
export function describeCall(call: ToolCall): string {
  const command = argString(call, 'command');
  const target = argString(call, 'path');
  if (call.name === 'run_command' && command) return `run_command ${clip(command.replace(/\s+/g, ' '), 160)}`;
  if (call.name === 'apply_patch') {
    const files = [...(argString(call, 'patch') ?? '').matchAll(/^\+\+\+ (?:b\/)?(.+)$/gm)].map((m) => m[1].trim());
    const named = files.filter((file) => file !== '/dev/null');
    return named.length ? `apply_patch ${named.join(', ')}` : 'apply_patch';
  }
  if (target) return `${call.name} ${target}`;
  const args = JSON.stringify(call.arguments ?? {});
  return args === '{}' ? call.name : `${call.name} ${clip(args, 120)}`;
}

/** A rule list joined for one suggestion, without repeating a rule. */
const joined = (rules: string[]) => [...new Set(rules)].join(', ');

const isWord = (token: string | undefined) => !!token && /^[A-Za-z0-9._:-]+$/.test(token) && !token.startsWith('-');

/**
 * Patterns a grant could remember, most specific first, in the rule syntax the permission
 * engine matches. A compound command is judged part by part, so each suggestion lists a
 * rule for every part. Nothing is suggested when the command hides code, because such a
 * command always asks and a grant could not change that.
 */
export function suggestPatterns(call: ToolCall): string[] {
  const command = argString(call, 'command');
  if (call.name === 'run_command' && command) {
    const analysis = analyzeCommand(command);
    if (analysis.hidden.length || !analysis.parts.length) return [];
    const words = analysis.parts.map((part) => part.split(/\s+/));
    const exact = joined(analysis.parts.map((part) => `run_command(${part})`));
    const subcommand = joined(
      words.map((tokens) => (tokens.length > 1 && isWord(tokens[1]) ? `run_command(${tokens[0]} ${tokens[1]} *)` : `run_command(${tokens[0]} *)`))
    );
    const program = joined(words.map((tokens) => `run_command(${tokens[0]} *)`));
    return [...new Set([exact, subcommand, program])];
  }
  if (call.name === 'apply_patch') {
    const files = patchPaths(argString(call, 'patch') ?? '');
    const dirs = [...new Set(files.map((file) => path.posix.dirname(file)))];
    const out = files.length ? [joined(files.map((file) => `apply_patch(${file})`))] : [];
    if (dirs.length && !dirs.includes('.')) out.push(joined(dirs.map((dir) => `apply_patch(${dir}/**)`)));
    return [...new Set([...out, 'apply_patch'])];
  }
  const target = argString(call, 'path');
  if (target) {
    const dir = path.posix.dirname(target.split(path.sep).join('/'));
    const out = [`${call.name}(${target})`];
    if (dir && dir !== '.') out.push(`${call.name}(${dir}/**)`);
    out.push(call.name);
    return out;
  }
  const namespace = call.name.includes('__') ? `${call.name.split('__')[0]}__*` : undefined;
  return namespace ? [call.name, namespace] : [call.name];
}

const readIfExists = (file: string): string | undefined => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

/** The effect of a call, computed without writing anything. */
export function previewCall(call: ToolCall, projectRoot: string): ApprovalPreview | undefined {
  const target = argString(call, 'path');
  try {
    if (call.name === 'run_command') {
      const command = argString(call, 'command') ?? '';
      const cwd = argString(call, 'cwd');
      return { kind: 'command', text: cwd ? `${command}\n(in ${cwd})` : command };
    }
    if (call.name === 'apply_patch') {
      return { kind: 'diff', text: clip(argString(call, 'patch') ?? '', MAX_PREVIEW_CHARS) };
    }
    if (call.name === 'write_file' && target) {
      const before = readIfExists(path.resolve(projectRoot, target)) ?? '';
      const after = typeof call.arguments.content === 'string' ? call.arguments.content : '';
      return { kind: 'diff', text: clip(createTwoFilesPatch(target, target, before, after, '', '', { context: 3 }), MAX_PREVIEW_CHARS) };
    }
    if (call.name === 'edit' && target) {
      const before = readIfExists(path.resolve(projectRoot, target));
      const find = argString(call, 'find_string');
      if (before !== undefined && find) {
        const after = replaceLiteral(before, find, String(call.arguments.replace_string ?? ''), target, {
          all: call.arguments.replace_all === true,
          occurrence: typeof call.arguments.occurrence === 'number' ? call.arguments.occurrence : undefined,
        }).content;
        return { kind: 'diff', text: clip(createTwoFilesPatch(target, target, before, after, '', '', { context: 3 }), MAX_PREVIEW_CHARS) };
      }
    }
  } catch {
    // The call will fail on its own terms when it runs; show its arguments instead.
  }
  return { kind: 'json', text: clip(JSON.stringify(call.arguments ?? {}, null, 2), MAX_PREVIEW_CHARS) };
}

let counter = 0;

export function buildApprovalRequest(
  call: ToolCall,
  options: { projectRoot: string; policyClass?: PolicyClass | 'unknown'; reason?: string }
): ApprovalRequest {
  counter += 1;
  return {
    id: `approval_${counter}`,
    call,
    policyClass: options.policyClass ?? 'unknown',
    summary: describeCall(call),
    preview: previewCall(call, options.projectRoot),
    reason: options.reason ?? 'this tool asks before it runs',
    suggestions: suggestPatterns(call),
  };
}
