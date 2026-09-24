import { isPlainObject } from './load.js';

export type KeyPath = (string | number)[];

/**
 * Read a key as `formatPath` writes one: dotted names, `[n]` for a list item, and
 * `["..."]` for a name with dots or colons in it, such as a model:
 * `models["ollama:qwen2.5-coder:7b"].context_window`.
 */
export function parseKeyPath(text: string): KeyPath | { error: string } {
  const path: KeyPath = [];
  let rest = text.trim();
  if (!rest) return { error: 'Name a key, such as agent_loop.max_steps.' };
  let first = true;
  while (rest) {
    if (rest.startsWith('[')) {
      const close = rest.indexOf(']');
      const inner = close > 0 ? rest.slice(1, close) : '';
      if (/^\d+$/.test(inner)) path.push(Number(inner));
      else {
        try {
          const parsed = JSON.parse(inner);
          if (typeof parsed !== 'string') throw new Error();
          path.push(parsed);
        } catch {
          return { error: `${text} is not a key: write a name with dots in it as ["name"].` };
        }
      }
      rest = rest.slice(close + 1);
    } else {
      if (!first) {
        if (!rest.startsWith('.')) return { error: `${text} is not a key.` };
        rest = rest.slice(1);
      }
      const match = /^[A-Za-z_$][\w$-]*/.exec(rest);
      if (!match) return { error: `${text} is not a key.` };
      path.push(match[0]);
      rest = rest.slice(match[0].length);
    }
    first = false;
  }
  return path;
}

export function getAt(root: unknown, path: KeyPath): unknown {
  let node: any = root;
  for (const part of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[part as any];
  }
  return node;
}

/** Set a value, creating the objects on the way. A list item is set only where the list already reaches. */
export function setAt(root: Record<string, any>, path: KeyPath, value: unknown): string | undefined {
  let node: any = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index];
    if (node[part] === undefined) node[part] = typeof path[index + 1] === 'number' ? [] : {};
    node = node[part];
    if (node === null || typeof node !== 'object') return `${String(part)} holds a value, not a section.`;
  }
  const last = path[path.length - 1];
  if (typeof last === 'number' && (!Array.isArray(node) || last > node.length)) return `There is no item ${last} to set.`;
  node[last as any] = value;
  return undefined;
}

/** Remove a value, and any section it leaves empty. Returns false when there was nothing to remove. */
export function unsetAt(root: Record<string, any>, path: KeyPath): boolean {
  const parents: any[] = [];
  let node: any = root;
  for (const part of path.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return false;
    parents.push(node);
    node = node[part as any];
  }
  const last = path[path.length - 1];
  if (node === null || typeof node !== 'object' || node[last as any] === undefined) return false;
  if (Array.isArray(node) && typeof last === 'number') node.splice(last, 1);
  else delete node[last as any];
  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const child = parents[index][path[index] as any];
    if (isPlainObject(child) && !Object.keys(child).length) delete parents[index][path[index] as any];
    else break;
  }
  return true;
}

const HIDDEN_KEYS = new Set(['api_key']);
const HIDDEN_SECTIONS = new Set(['headers', 'env']);

/** Keys and header or environment values are shown as hidden, so configuration output never prints one. */
export function maskSecrets(value: unknown, path: KeyPath = []): unknown {
  const last = path[path.length - 1];
  const parent = path[path.length - 2];
  const hidden = (typeof last === 'string' && HIDDEN_KEYS.has(last)) || (typeof parent === 'string' && HIDDEN_SECTIONS.has(parent));
  if (hidden && value !== undefined && typeof value !== 'object') return '(hidden)';
  if (Array.isArray(value)) return value.map((item, index) => maskSecrets(item, [...path, index]));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskSecrets(item, [...path, key])]));
  return value;
}
