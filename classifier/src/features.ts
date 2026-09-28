import path from 'path';
import { analyzeCommand } from '../../src/core/permissions/command.js';
import { readOnlyReason } from '../../src/core/tools/readonly.js';
import type { Example } from './types.js';

/** What the model may know about a call: the call, where it is made, and the person's own earlier decisions. */
export type Query = Pick<Example, 'tool' | 'args' | 'projectRoot' | 'mode' | 'surface' | 'child' | 'history'>;

const NET = new Set(['curl', 'wget', 'nc', 'ncat', 'ssh', 'scp', 'rsync', 'ping', 'dig', 'nslookup', 'telnet']);
const WRITERS = new Set(['rm', 'mv', 'cp', 'touch', 'mkdir', 'chmod', 'chown', 'tee', 'ln', 'install', 'rmdir']);
const TOKEN = /[A-Za-z][A-Za-z0-9_-]{2,19}/g;

const program = (part: string) => (part.split(/\s+/)[0] ?? '').replace(/^.*\//, '');
const bucket = (value: number, edges: number[]) => edges.findIndex((edge) => value <= edge) + 1 || edges.length + 1;

/** A command with what varies between sessions replaced, so the same act reads the same. */
export function normalizeCommand(command: string): string {
  return command
    .replace(/"[^"]*"|'[^']*'/g, '<q>')
    .replace(/(^|\s)[^\s]*\/[^\s]*/g, '$1<path>')
    .replace(/\b\d+(?:\.\d+)*\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What identifies a call for "the person allowed this before". */
export function callKey(tool: string, args: Record<string, unknown>): string {
  if (tool === 'run_command') return `run_command:${normalizeCommand(typeof args.command === 'string' ? args.command : '')}`;
  const target = typeof args.path === 'string' ? path.extname(args.path) : '';
  if (typeof args.url === 'string') {
    try {
      return `${tool}:${new URL(args.url).hostname}`;
    } catch {
      return `${tool}:?`;
    }
  }
  if (tool === 'task') return `task:${String(args.agent ?? 'default')}`;
  return `${tool}:${target}`;
}

function commandFeatures(command: string, root: string): string[] {
  const out: string[] = [];
  const analysis = analyzeCommand(command);
  const programs = analysis.parts.map(program);
  programs.forEach((name, index) => {
    out.push(`prog=${name}`);
    if (index === 0) out.push(`first=${name}`);
    const words = analysis.parts[index].split(/\s+/).filter(Boolean);
    const second = words[1];
    if (second && !second.startsWith('-') && /^[A-Za-z][\w:-]*$/.test(second)) out.push(`cmd2=${name} ${second}`);
    for (const word of words.slice(1)) if (word.startsWith('-') && word.length <= 14 && !word.includes('=')) out.push(`flag=${name}:${word}`);
    if (NET.has(name)) out.push('net');
    if (WRITERS.has(name)) out.push('writer');
  });
  out.push(`parts=${bucket(analysis.parts.length, [1, 2, 4, 8])}`, `len=${bucket(command.length, [20, 40, 80, 160, 320])}`);
  if (analysis.hidden.length) out.push('hidden');
  if (analysis.redirects.length) out.push('redirect');
  if (/^\s*(cd|pwd)\b/.test(command)) out.push('starts_cd');
  if (readOnlyReason(analysis, root) === undefined) out.push('readonly');
  const args = command.match(/(?:^|\s)(\/[^\s'"]*|\.\.\/[^\s'"]*|~\/[^\s'"]*)/g) ?? [];
  const resolved = args.map((arg) => arg.trim().replace(/^~/, '/home'));
  if (resolved.some((arg) => !path.resolve(root, arg).startsWith(path.resolve(root)))) out.push('outside_path');
  if (/\/tmp\b/.test(command)) out.push('tmp');
  const seen = new Set<string>();
  for (const token of normalizeCommand(command).match(TOKEN) ?? []) {
    if (seen.size >= 40) break;
    seen.add(token.toLowerCase());
  }
  for (const token of seen) out.push(`tok=${token}`);
  return out;
}

const IDENTITY = ['prog=', 'domain=', 'agent=', 'ext=', 'dir='];

/** The features that say what a call is, as opposed to how or where it is made. */
export const identityOf = (names: string[]): string[] => names.filter((name) => IDENTITY.some((prefix) => name.startsWith(prefix)));

/** The named binary features of one call. A dictionary built at training time decides which count. */
export function featurize(query: Query): string[] {
  const out = [`tool=${query.tool}`, `mode=${query.mode}`, `surface=${query.surface}`, ...(query.child ? ['child'] : [])];
  const args = query.args;
  if (query.tool === 'run_command' && typeof args.command === 'string') out.push(...commandFeatures(args.command, query.projectRoot));
  if (typeof args.path === 'string') {
    out.push(`ext=${path.extname(args.path) || 'none'}`);
    const first = path.relative(query.projectRoot, path.resolve(query.projectRoot, args.path)).split(path.sep)[0];
    out.push(first.startsWith('..') ? 'path_outside' : `dir=${first || '.'}`);
  }
  if (typeof args.url === 'string') {
    try {
      const host = new URL(args.url).hostname;
      out.push(`domain=${host}`, `tld=${host.split('.').pop()}`);
    } catch {
      out.push('bad_url');
    }
  }
  if (query.tool === 'task') out.push(`agent=${String(args.agent ?? 'default')}`);
  const h = query.history;
  if (h.priorHuman === 0) out.push('first_in_project');
  if (h.seenAllowed) out.push('seen_allowed');
  if (h.seenDenied) out.push('seen_denied');
  if (h.priorHuman >= 5) out.push(`allow_rate=${Math.min(4, Math.floor((h.priorAllows / h.priorHuman) * 5))}`);
  return [...new Set(out)];
}
