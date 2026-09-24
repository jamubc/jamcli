/**
 * What a shell command line will run, as far as rules need to know: each simple command,
 * the constructs that run code the parts do not show, and where output is redirected.
 * The parser is deliberately conservative: when it cannot tell, the result asks rather
 * than allows.
 */

export interface Redirect {
  op: string;
  /** The target as the shell would see it, with quotes removed. */
  target: string;
  /** The target contains an expansion, so where it points is unknown until it runs. */
  dynamic: boolean;
}

export interface CommandAnalysis {
  /** Each simple command, with control keywords removed. */
  parts: string[];
  /** Why the line runs code its parts do not show, if it does. */
  hidden: string[];
  redirects: Redirect[];
}

const SEPARATORS = ['&&', '||', '|&', ';;', ';', '|', '&', '\n'];
const LEADING_KEYWORDS = new Set(['!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', 'time', '{']);
const CLOSING_WORDS = new Set(['fi', 'done', 'esac', 'then', 'else', 'do', '{', '}']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'ash', 'pwsh']);

interface Heredoc {
  delimiter: string;
  strip: boolean;
  expands: boolean;
}

const isBlank = (char: string | undefined) => char === ' ' || char === '\t';
const endsWord = (char: string | undefined) => char === undefined || /[\s;&|<>()]/.test(char);

/** Read one shell word starting at `start`, returning its unquoted text and where it ends. */
const readWord = (line: string, start: number): { text: string; end: number; dynamic: boolean } => {
  let i = start;
  let text = '';
  let dynamic = false;
  let quote: string | null = null;
  while (i < line.length) {
    const char = line[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (quote === '"' && (char === '$' || char === '`')) {
        dynamic = true;
        text += char;
      } else text += char;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      i += 1;
      continue;
    }
    if (char === '\\') {
      text += line[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (endsWord(char)) break;
    if (char === '$' || char === '`' || char === '*' || char === '?' || char === '[') dynamic = true;
    text += char;
    i += 1;
  }
  return { text, end: i, dynamic };
};

/** Skip the bodies of pending here-documents, which start on the next line. */
const skipHeredocs = (line: string, start: number, pending: Heredoc[], hidden: string[]): number => {
  let i = start;
  for (const doc of pending) {
    while (i < line.length) {
      const next = line.indexOf('\n', i);
      const end = next === -1 ? line.length : next;
      const text = line.slice(i, end);
      i = end + 1;
      const candidate = doc.strip ? text.replace(/^\t+/, '') : text;
      if (candidate === doc.delimiter) break;
      if (doc.expands && (text.includes('$(') || text.includes('`'))) hidden.push('command substitution in a here-document');
    }
  }
  return Math.min(i, line.length);
};

const programOf = (part: string) => part.split(/\s+/)[0] ?? '';

const runsCode = (raw: string) => raw.includes('$(') || raw.includes('`') || raw.includes('<(') || raw.includes('>(');

/** Constructs whose real command is inside an argument, so no rule can see it. */
const hiddenIn = (part: string): string | undefined => {
  const words = part.split(/\s+/);
  const program = words[0]?.replace(/^.*\//, '') ?? '';
  if (program === 'eval') return 'eval';
  if (program === 'source' || program === '.') return `${program} runs a script`;
  if (SHELLS.has(program) && words.includes('-c')) return `${program} -c`;
  if (program === 'xargs') return 'xargs runs a command from its input';
  if (program === 'find' && words.some((word) => /^-(exec|execdir|ok|okdir)$/.test(word))) return 'find -exec';
  return undefined;
};

const cleanPart = (raw: string): string | undefined => {
  let words = raw.replace(/\\\n/g, ' ').trim().split(/\s+/).filter(Boolean);
  while (words.length && LEADING_KEYWORDS.has(words[0])) words = words.slice(1);
  if (words.length && words[words.length - 1] === '}') words = words.slice(0, -1);
  if (!words.length || (words.length === 1 && CLOSING_WORDS.has(words[0]))) return undefined;
  return words.join(' ');
};

export function analyzeCommand(command: string): CommandAnalysis {
  const rawParts: string[] = [];
  const hidden: string[] = [];
  const redirects: Redirect[] = [];
  const pending: Heredoc[] = [];
  let current = '';
  let quote: string | null = null;
  let i = 0;

  const push = () => {
    rawParts.push(current);
    current = '';
  };

  while (i < command.length) {
    const char = command[i];

    if (quote === "'") {
      current += char;
      if (char === "'") quote = null;
      i += 1;
      continue;
    }
    if (char === '\\') {
      current += command.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '$' && command[i + 1] === '(') hidden.push('command substitution $(...)');
      else if (char === '`') hidden.push('command substitution `...`');
      current += char;
      i += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      i += 1;
      continue;
    }
    if (char === '#' && (current === '' || isBlank(current[current.length - 1]) || current.endsWith('\n'))) {
      const newline = command.indexOf('\n', i);
      i = newline === -1 ? command.length : newline;
      continue;
    }
    if (char === '$' && command[i + 1] === '(') {
      hidden.push('command substitution $(...)');
      current += char;
      i += 1;
      continue;
    }
    if (char === '`') {
      hidden.push('command substitution `...`');
      current += char;
      i += 1;
      continue;
    }
    if ((char === '<' || char === '>') && command[i + 1] === '(') {
      hidden.push('process substitution');
      current += char;
      i += 1;
      continue;
    }

    // Here-documents and here-strings feed input; they name no file.
    if (char === '<' && command[i + 1] === '<') {
      if (command[i + 2] === '<') {
        let j = i + 3;
        while (isBlank(command[j])) j += 1;
        const word = readWord(command, j);
        if (runsCode(command.slice(j, word.end))) hidden.push('command substitution in a here-string');
        current += ' ';
        i = word.end;
        continue;
      }
      let j = i + 2;
      const strip = command[j] === '-';
      if (strip) j += 1;
      while (isBlank(command[j])) j += 1;
      const quoted = command[j] === "'" || command[j] === '"' || command[j] === '\\';
      const word = readWord(command, j);
      pending.push({ delimiter: word.text, strip, expands: !quoted });
      current += ' ';
      i = word.end;
      continue;
    }

    // Redirections, except duplicating a descriptor such as 2>&1.
    if (char === '>' || char === '<' || (char === '&' && command[i + 1] === '>')) {
      // A descriptor number written against the operator, as in 2>, belongs to it.
      current = current.replace(/(^|\s)\d+$/, '$1');
      let j = i;
      let op = '';
      if (char === '&') {
        op = '&';
        j += 1;
      }
      while ((command[j] === '>' || command[j] === '<' || (command[j] === '|' && op.endsWith('>'))) && op.length < 3) {
        op += command[j];
        j += 1;
      }
      if (command[j] === '&') {
        // Duplicating a descriptor, such as 2>&1, names no file.
        j += 1;
        while (/[0-9-]/.test(command[j] ?? '')) j += 1;
        current += ' ';
        i = j;
        continue;
      }
      while (isBlank(command[j])) j += 1;
      const word = readWord(command, j);
      if (runsCode(command.slice(j, word.end))) hidden.push('command substitution in a redirection');
      redirects.push({ op, target: word.text, dynamic: word.dynamic || !word.text });
      current += ' ';
      i = word.end;
      continue;
    }

    const separator = SEPARATORS.find((candidate) => command.startsWith(candidate, i));
    if (separator) {
      push();
      i += separator.length;
      if (separator === '\n' && pending.length) {
        i = skipHeredocs(command, i, pending, hidden);
        pending.length = 0;
      }
      continue;
    }
    if (char === '(' || char === ')') {
      push();
      i += 1;
      continue;
    }
    current += char;
    i += 1;
  }
  push();
  if (quote) hidden.push('an unterminated quote');

  const parts: string[] = [];
  for (const raw of rawParts) {
    const part = cleanPart(raw);
    if (!part) continue;
    parts.push(part);
    const reason = hiddenIn(part);
    if (reason) hidden.push(reason);
  }
  return { parts, hidden: [...new Set(hidden)], redirects };
}

export { programOf };
