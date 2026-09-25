/**
 * The workflow expression grammar (D19): property paths, string, number, boolean, and null
 * literals, comparisons, `and`, `or`, `not`, and parentheses. It is parsed and evaluated
 * here, never handed to JavaScript, so a workflow file cannot run code through a condition.
 */

type Token = { kind: 'path' | 'string' | 'number' | 'word' | 'op' | 'paren'; value: string };

export type Expr =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'path'; path: string[] }
  | { kind: 'not'; operand: Expr }
  | { kind: 'binary'; op: 'and' | 'or' | '==' | '!=' | '<' | '<=' | '>' | '>='; left: Expr; right: Expr };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const space = /^\s+/.exec(rest);
    if (space) {
      i += space[0].length;
      continue;
    }
    const string = /^'((?:[^'\\]|\\.)*)'|^"((?:[^"\\]|\\.)*)"/.exec(rest);
    if (string) {
      tokens.push({ kind: 'string', value: (string[1] ?? string[2]).replace(/\\(.)/g, '$1') });
      i += string[0].length;
      continue;
    }
    const number = /^-?\d+(\.\d+)?/.exec(rest);
    if (number) {
      tokens.push({ kind: 'number', value: number[0] });
      i += number[0].length;
      continue;
    }
    const op = /^(==|!=|<=|>=|<|>)/.exec(rest);
    if (op) {
      tokens.push({ kind: 'op', value: op[0] });
      i += op[0].length;
      continue;
    }
    if (rest[0] === '(' || rest[0] === ')') {
      tokens.push({ kind: 'paren', value: rest[0] });
      i += 1;
      continue;
    }
    const word = /^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*/.exec(rest);
    if (word) {
      const value = word[0];
      tokens.push({ kind: ['and', 'or', 'not', 'true', 'false', 'null'].includes(value) ? 'word' : 'path', value });
      i += value.length;
      continue;
    }
    throw new Error(`unexpected "${rest[0]}" at column ${i + 1}`);
  }
  return tokens;
}

/** Parse a condition. Throws with where it went wrong. */
export function parseExpr(text: string): Expr {
  const tokens = tokenize(text);
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const or = (): Expr => {
    let left = and();
    while (peek()?.kind === 'word' && peek().value === 'or') {
      take();
      left = { kind: 'binary', op: 'or', left, right: and() };
    }
    return left;
  };
  const and = (): Expr => {
    let left = not();
    while (peek()?.kind === 'word' && peek().value === 'and') {
      take();
      left = { kind: 'binary', op: 'and', left, right: not() };
    }
    return left;
  };
  const not = (): Expr => {
    if (peek()?.kind === 'word' && peek().value === 'not') {
      take();
      return { kind: 'not', operand: not() };
    }
    return comparison();
  };
  const comparison = (): Expr => {
    const left = primary();
    if (peek()?.kind === 'op') {
      const op = take().value as '==' | '!=' | '<' | '<=' | '>' | '>=';
      return { kind: 'binary', op, left, right: primary() };
    }
    return left;
  };
  const primary = (): Expr => {
    const token = take();
    if (!token) throw new Error('the condition ends too early');
    if (token.kind === 'paren' && token.value === '(') {
      const inner = or();
      if (take()?.value !== ')') throw new Error('a "(" is not closed');
      return inner;
    }
    if (token.kind === 'string') return { kind: 'literal', value: token.value };
    if (token.kind === 'number') return { kind: 'literal', value: Number(token.value) };
    if (token.kind === 'word' && ['true', 'false', 'null'].includes(token.value)) return { kind: 'literal', value: token.value === 'null' ? null : token.value === 'true' };
    if (token.kind === 'path') return { kind: 'path', path: token.value.split('.') };
    throw new Error(`unexpected "${token.value}"`);
  };
  const expr = or();
  if (at < tokens.length) throw new Error(`unexpected "${tokens[at].value}"`);
  return expr;
}

/** Read a dotted path from a value; a missing step reads as null. */
export function lookup(context: unknown, path: string[]): unknown {
  let value: any = context;
  for (const part of path) {
    if (value === null || value === undefined || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) return null;
    value = value[part];
  }
  return value === undefined ? null : value;
}

const truthy = (value: unknown) => value !== null && value !== false && value !== 0 && value !== '';

export function evaluate(expr: Expr, context: unknown): unknown {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'path':
      return lookup(context, expr.path);
    case 'not':
      return !truthy(evaluate(expr.operand, context));
    case 'binary': {
      if (expr.op === 'and') return truthy(evaluate(expr.left, context)) && truthy(evaluate(expr.right, context));
      if (expr.op === 'or') return truthy(evaluate(expr.left, context)) || truthy(evaluate(expr.right, context));
      const left = evaluate(expr.left, context) as any;
      const right = evaluate(expr.right, context) as any;
      switch (expr.op) {
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '<':
          return left < right;
        case '<=':
          return left <= right;
        case '>':
          return left > right;
        case '>=':
          return left >= right;
      }
    }
  }
}

/** Whether a condition holds. */
export const holds = (text: string, context: unknown) => truthy(evaluate(parseExpr(text), context));

const TEMPLATE = /\{\{\s*([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)\s*\}\}/g;

/** The paths a template names, to check them when the workflow loads. */
export const templatePaths = (text: string) => [...text.matchAll(TEMPLATE)].map((match) => match[1]);

/** Fill `{{ path }}` from the context. Nothing else in the text is read. */
export const render = (text: string, context: unknown) =>
  text.replace(TEMPLATE, (_, path: string) => {
    const value = lookup(context, path.split('.'));
    return value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
