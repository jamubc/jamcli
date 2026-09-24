import type { z } from 'zod';

type Path = PropertyKey[];

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A key path as it is written in a file: `agent_loop.max_steps`, `endpoints[0].id`, `models["ollama:qwen"]`. */
export function formatPath(path: Path): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else if (IDENTIFIER.test(String(part))) out += out ? `.${String(part)}` : String(part);
    else out += `[${JSON.stringify(String(part))}]`;
  }
  return out;
}

const withArticle = (noun: string) => (/^[aeiou]/.test(noun) ? `an ${noun}` : `a ${noun}`);

/** What the schema expected, in words; never the value found, which may be a key. */
function expectation(issue: z.core.$ZodIssue): string {
  // A schema that names its shape is taken at its word.
  if (issue.message.startsWith('expected ')) return issue.message.slice('expected '.length);
  switch (issue.code) {
    case 'invalid_type':
      return withArticle(issue.expected === 'int' ? 'integer' : issue.expected === 'record' ? 'object' : String(issue.expected));
    case 'too_small': {
      if (issue.origin === 'string' && Number(issue.minimum) === 1) return 'a non-empty string';
      if (issue.origin === 'number' && Number(issue.minimum) === 0) return issue.inclusive ? 'a number of 0 or more' : 'a positive number';
      return `${withArticle(String(issue.origin))} of at least ${issue.minimum}`;
    }
    case 'too_big':
      return `${withArticle(String(issue.origin))} of at most ${issue.maximum}`;
    case 'invalid_value':
      return `one of ${issue.values.map((value) => JSON.stringify(value)).join(', ')}`;
    case 'invalid_union':
      return 'a value of another shape';
    default:
      return issue.message.replace(/^Invalid input: /, '').replace(/\.$/, '');
  }
}

const DROP = Symbol('drop');

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function mark(root: unknown, path: Path): void {
  if (!path.length) return;
  let parent: any = root;
  for (const part of path.slice(0, -1)) {
    if (parent === null || typeof parent !== 'object') return;
    parent = parent[part as any];
  }
  if (parent === null || typeof parent !== 'object') return;
  const key = path[path.length - 1] as any;
  if (parent[key] === undefined) {
    // A required key is missing: what holds it cannot stand.
    mark(root, path.slice(0, -1));
    return;
  }
  parent[key] = DROP;
}

/** Take out what was marked, and any object left empty by it, so an emptied section does not mask a lower layer's. */
function sweep(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => item !== DROP).map(sweep);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === DROP) continue;
    const swept = sweep(item);
    if (isRecord(item) && Object.keys(item).length && isRecord(swept) && !Object.keys(swept).length) continue;
    out[key] = swept;
  }
  return out;
}

export interface Validated<T> {
  /** What is left once every invalid value is taken out; undefined when nothing usable is. */
  value?: T;
  errors: string[];
}

/**
 * Check a layer against its schema. A value that does not fit is taken out and named,
 * with the shape expected, so the rest of the layer still applies and a lower layer's
 * value shows through. `where` names the layer, as a file or a variable; values are
 * never quoted back, since a misplaced key would otherwise be printed.
 */
export function validateLayer<T>(schema: z.ZodType<T>, input: unknown, where: string, options: { single?: boolean } = {}): Validated<T> {
  const errors: string[] = [];
  let value = structuredClone(input);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = schema.safeParse(value);
    if (result.success) return { value: value as T, errors };
    for (const issue of result.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        for (const key of issue.keys) {
          const at = [...issue.path, key];
          errors.push(`${where}: ${formatPath(at)} is not a setting JamCLI knows, so it is ignored.`);
          mark(value, at);
        }
        continue;
      }
      if (!issue.path.length) {
        errors.push(`${where} should hold ${expectation(issue)}, so it is ignored.`);
        return { errors };
      }
      const key = options.single ? '' : ` ${formatPath(issue.path)}`;
      errors.push(`${where}${key} should be ${expectation(issue)}, so it is ignored.`);
      mark(value, issue.path);
    }
    value = sweep(value);
  }
  errors.push(`${where} could not be read as configuration, so it is ignored.`);
  return { errors };
}
