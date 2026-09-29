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
/** Programs that run whatever code their arguments or input carry: a rule about them is a rule about anything. */
const INTERPRETERS = new Set([...SHELLS, 'node', 'bun', 'deno', 'python', 'python2', 'python3', 'perl', 'ruby', 'php', 'osascript']);
/** Flags under which an interpreter takes its program from the argument after them. */
const INLINE_CODE_FLAGS = new Set(['-c', '-e', '-E', '-p', '--eval', '--print']);
/** Arguments that make an interpreter print and exit rather than read a program. */
const INERT_FLAGS = new Set(['--version', '-v', '-V', '--help', '-h']);
/** Programs that raise privileges: whatever follows runs as someone else. */
const ESCALATORS = new Set(['sudo', 'doas', 'su']);
/** Programs that only start the command after them, which is the one a rule is about. */
const WRAPPERS = new Set(['env', 'exec', 'command', 'builtin', 'nohup', 'nice', 'timeout', 'caffeinate', 'stdbuf']);
/** Variables whose value decides which program runs, so setting one hides the program. */
const LOADER_VARIABLES = /^(PATH|LD_[A-Z_]+|DYLD_[A-Z_]+|NODE_OPTIONS|BASH_ENV|ENV|IFS|PYTHONPATH|PYTHONSTARTUP|PERL5OPT|PERL5LIB|RUBYOPT|GIT_EXEC_PATH|GIT_SSH|GIT_SSH_COMMAND|GIT_PAGER|PAGER)$/;

/** Whether a program runs whatever it is handed, so no rule can name what it will do. */
export const isInterpreter = (program: string): boolean => INTERPRETERS.has(program.replace(/^.*\//, ''));

interface Heredoc {
  delimiter: string;
  strip: boolean;
  expands: boolean;
}

const isBlank = (char: string | undefined) => char === ' ' || char === '\t';
/** Whether the character at `index` is escaped: preceded by an odd run of backslashes. */
const escapedAt = (text: string, index: number): boolean => {
  let count = 0;
  for (let j = index - 1; j >= 0 && text[j] === '\\'; j -= 1) count += 1;
  return count % 2 === 1;
};
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

const flagName = (word: string) => word.split('=')[0];

/**
 * Constructs whose real command is inside an argument, so no rule can see it: a shell or
 * interpreter given code inline or on its input, privilege escalation, and flags that name
 * a program for the tool to run, such as git's pager or npm's script shell.
 */
const hiddenIn = (part: string): string | undefined => {
  const words = part.split(/\s+/);
  const program = words[0]?.replace(/^.*\//, '') ?? '';
  const rest = words.slice(1);
  if (program === 'eval') return 'eval';
  if (program === 'source' || program === '.') return `${program} runs a script`;
  if (ESCALATORS.has(program)) return `${program} raises privileges`;
  if (INTERPRETERS.has(program)) {
    const inline = rest.find((word) => INLINE_CODE_FLAGS.has(word));
    if (inline) return `${program} ${inline}`;
    if (!rest.some((word) => !word.startsWith('-')) && !(rest.length && rest.every((word) => INERT_FLAGS.has(word)))) return `${program} runs code from its input`;
  }
  if (program === 'xargs') return 'xargs runs a command from its input';
  if (program === 'find' && rest.some((word) => /^-(exec|execdir|ok|okdir)$/.test(word))) return 'find -exec';
  if (program === 'git') {
    // Only git's own flags, before the subcommand, name programs it runs.
    const own = rest.slice(0, rest.findIndex((word) => !word.startsWith('-')) === -1 ? rest.length : rest.findIndex((word) => !word.startsWith('-')));
    const named = own.find((word) => word.startsWith('-c') || ['--config-env', '--exec-path'].includes(flagName(word)));
    if (named) return `git ${named.startsWith('-c') ? '-c' : flagName(named)}`;
    if (rest[own.length] === 'config') return 'git config';
  }
  if (['npm', 'yarn', 'pnpm'].includes(program) && rest.some((word) => flagName(word) === '--script-shell')) return `${program} --script-shell`;
  if (program === 'npx') {
    const flag = rest.find((word) => ['-c', '-p', '--package'].includes(flagName(word)));
    if (flag) return `npx ${flagName(flag)}`;
  }
  if (program === 'make' && rest.some((word) => word.startsWith('SHELL='))) return 'make SHELL=';
  return undefined;
};

const isAssignment = (word: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);

/**
 * One simple command as a rule sees it: control keywords, wrappers such as `nohup` or
 * `env`, and leading variable assignments are stripped, so the program a rule names is the
 * one that runs. An assignment that changes which program runs, such as `PATH=`, hides it.
 */
const cleanPart = (raw: string): { part: string; hidden?: string } | undefined => {
  let words = raw.replace(/\\\n/g, ' ').trim().split(/\s+/).filter(Boolean);
  while (words.length && LEADING_KEYWORDS.has(words[0])) words = words.slice(1);
  if (words.length && words[words.length - 1] === '}') words = words.slice(0, -1);
  let hidden: string | undefined;
  /** The last wrapper, which is the program that runs when nothing but assignments follows it: `env x=1` prints the environment. */
  let bare: string[] | undefined;
  for (;;) {
    while (words.length && isAssignment(words[0])) {
      const name = words[0].split('=')[0];
      if (LOADER_VARIABLES.test(name)) hidden ??= `${name} changes what runs`;
      words = words.slice(1);
    }
    if (!words.length || !WRAPPERS.has(words[0].replace(/^.*\//, ''))) break;
    bare = words;
    words = words.slice(1);
    // The wrapper's own flags and counts, such as `timeout -k 5 30`, are not the program.
    while (words.length && (words[0].startsWith('-') || /^\d+[smhd]?$/.test(words[0]))) words = words.slice(1);
  }
  if (!words.length && bare) return { part: bare.join(' '), ...(hidden ? { hidden } : {}) };
  if (!words.length) return hidden ? { part: '', hidden } : undefined;
  if (words.length === 1 && CLOSING_WORDS.has(words[0])) return undefined;
  return { part: words.join(' '), ...(hidden ? { hidden } : {}) };
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
    // A # starts a comment only at the start of a word: after an escaped blank it is part of the word.
    const before = current.length - 1;
    if (char === '#' && (current === '' || ((isBlank(current[before]) || current[before] === '\n') && !escapedAt(current, before)))) {
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
      if (command[j] === '&' && !op.includes('&')) {
        j += 1;
        while (isBlank(command[j])) j += 1;
        const word = readWord(command, j);
        // Duplicating or closing a descriptor, such as 2>&1 or >&-, names no file. Any other
        // word after >& is a file that both output streams go to, as after &>.
        if (/^(\d+|-)$/.test(word.text)) {
          current += ' ';
          i = word.end;
          continue;
        }
        if (runsCode(command.slice(j, word.end))) hidden.push('command substitution in a redirection');
        redirects.push({ op: `${op}&`, target: word.text, dynamic: word.dynamic || !word.text });
        current += ' ';
        i = word.end;
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
    const cleaned = cleanPart(raw);
    if (!cleaned) continue;
    if (cleaned.hidden) hidden.push(cleaned.hidden);
    if (!cleaned.part) continue;
    parts.push(cleaned.part);
    const reason = hiddenIn(cleaned.part);
    if (reason) hidden.push(reason);
  }
  return { parts, hidden: [...new Set(hidden)], redirects };
}

export { programOf };
