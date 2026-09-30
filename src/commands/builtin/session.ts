import fs from 'fs';
import path from 'path';
import { choiceOf } from '../../core/routing/capabilities.js';
import { formatUsd } from '../../core/catalog/cost.js';
import { JAMCLI_VERSION } from '../../core/version.js';
import { ensureProjectStateDir, readTranscript, sessionFileFor, transcriptToMarkdown } from '../../core/transcript/index.js';
import { describeWake, flagName, parseDuration } from '../../core/wake/index.js';
import { SESSION_COLORS, type SessionColor } from '../../core/runtime/extras.js';
import type { SessionNote } from '../../core/runtime/index.js';
import { contextReport } from '../reports.js';
import { splitWords } from '../parse.js';
import type { CommandContext, SlashCommand } from '../types.js';

/** A note's time as the clock read it, with the day when it was not today. */
export const noteTime = (ts: number, now = Date.now()): string => {
  const at = new Date(ts);
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return new Date(now).toDateString() === at.toDateString() ? clock : `${at.toISOString().slice(0, 10)} ${clock}`;
};

/** Every note of the session, oldest first, each with its time. */
export const notesList = (notes: SessionNote[]): string =>
  notes.length ? [`Tester notes in this session, oldest first (${notes.length}):`, ...notes.map((note) => `- ${noteTime(note.ts)} ${note.text}`)].join('\n') : 'No tester notes in this session. /note <text> plants one.';

export const rename: SlashCommand = {
  name: 'rename',
  args: '<name>',
  summary: 'Name this session; the name works wherever its id does',
  source: 'built-in',
  run(ctx, args) {
    if (!args) return ctx.notice('info', ctx.runtime.name ? `This session is called ${ctx.runtime.name}. /rename <name> changes it.` : 'Usage: /rename <name>, one word of letters, digits, - _ and .');
    const refusal = ctx.runtime.rename(args);
    if (refusal) return ctx.notice('warn', refusal);
    ctx.refresh();
    ctx.notice('info', `This session is called ${ctx.runtime.name}. /resume ${ctx.runtime.name} opens it.`);
  },
};

const isColor = (word: string): word is SessionColor => (SESSION_COLORS as readonly string[]).includes(word);

export const color: SlashCommand = {
  name: 'color',
  aliases: ['colour'],
  args: `[${SESSION_COLORS.join('|')}|default]`,
  summary: "Color this session's composer border and status line, to tell sessions apart",
  source: 'built-in',
  run(ctx, args) {
    const apply = (word: string) => {
      if (word !== 'default' && !isColor(word)) return ctx.notice('warn', `The color is one of ${SESSION_COLORS.join(', ')}, or default, not ${word}.`);
      ctx.runtime.setColor(word === 'default' ? undefined : word);
      ctx.refresh();
      ctx.notice('info', word === 'default' ? "This session takes the theme's colors." : `This session is ${word}: the composer's border and the status line show it.`);
    };
    const word = args.trim().toLowerCase();
    if (word) return apply(word);
    const current = ctx.runtime.color ?? 'default';
    ctx.choose({
      title: 'Color this session',
      items: [...SESSION_COLORS, 'default'].map((name) => ({ key: name, label: name, ...(name === current ? { current: true } : {}) })),
      empty: 'No colors.',
      hint: 'Enter colors the composer border and the status line',
      choose: (item) => apply(item.key),
    });
  },
};

const FLAG_USAGE = 'Usage: /flag <name> raises it on this session, /flag lower <name> lowers it, /flag list <session...> shows sessions\' flags.';

export const flag: SlashCommand = {
  name: 'flag',
  aliases: ['flags'],
  args: '[<name>|lower <name>|list <session...>]',
  summary: 'Raise or lower a flag on this session that other sessions can wait for',
  source: 'built-in',
  run(ctx, args) {
    const words = splitWords(args);
    const show = (refs: string[]) => {
      const listed = ctx.runtime.flags(refs);
      if ('error' in listed) return ctx.notice('warn', listed.error);
      ctx.show(listed.map((entry) => `${entry.session}: ${entry.flags.length ? entry.flags.join(', ') : 'no flag raised'}`).join('\n'));
    };
    if (!words.length) return show([]);
    if (words[0] === 'list') return show(words.slice(1));
    const lowering = words[0] === 'lower';
    const named = flagName((lowering ? words[1] : words[0]) ?? '');
    if ('error' in named || words.length > (lowering ? 2 : 1)) return ctx.notice('warn', 'error' in named ? `${named.error} ${FLAG_USAGE}` : FLAG_USAGE);
    if (lowering) ctx.runtime.lowerFlag(named.flag);
    else ctx.runtime.raiseFlag(named.flag);
    ctx.notice('info', `${lowering ? 'Lowered' : 'Raised'} ${named.flag} on ${ctx.runtime.name ?? ctx.runtime.sessionId}.`);
  },
};

const WAKE_USAGE = [
  'Usage:',
  '  /wake in 10m <prompt>                       run the prompt in this session once 10 minutes have passed',
  '  /wake when <session...> raise <flag>: <prompt>   run it once every named session has raised the flag',
  '  /wake list                                   show what is pending',
  '  /wake cancel <id|all>                        remove one, or every one',
  'A message you send meanwhile does not cancel a wake.',
].join('\n');

/** `/wake when a b raise green: prompt`, read into its sessions, flag, and prompt. */
function readWhen(rest: string): { sessions: string[]; flag: string; prompt: string } | { error: string } {
  const match = /^(.+?)\s+raises?\s+([^\s:]+):?\s+([\s\S]+)$/i.exec(rest.trim());
  if (!match) return { error: WAKE_USAGE };
  const named = flagName(match[2]);
  if ('error' in named) return named;
  return { sessions: splitWords(match[1].replace(/,/g, ' ')), flag: named.flag, prompt: match[3].replace(/^:\s*/, '') };
}

export const wake: SlashCommand = {
  name: 'wake',
  aliases: ['timer'],
  args: '[in <time> <prompt>|when <session...> raise <flag>: <prompt>|list|cancel <id|all>]',
  summary: 'Run a prompt in this session later, after a time or once other sessions raise a flag',
  source: 'built-in',
  run(ctx, args) {
    const now = Date.now();
    const trimmed = args.trim();
    const [first = '', ...rest] = trimmed.split(/\s+/);
    const list = () => {
      const pending = ctx.runtime.wakes();
      ctx.show(pending.length ? pending.map((item) => describeWake(item, now)).join('\n') : 'No wakes are pending. /wake in 10m <prompt> sets one.');
    };
    if (!trimmed || first === 'list') return list();
    if (first === 'cancel') {
      const removed = ctx.runtime.cancelWake(rest[0] ?? '');
      return ctx.notice(removed.length ? 'info' : 'warn', removed.length ? `Cancelled ${removed.map((item) => item.id).join(', ')}.` : `No wake ${rest[0] ?? ''} is pending. /wake list shows them.`);
    }
    let made: ReturnType<typeof ctx.runtime.setWake>;
    if (first === 'when') {
      const read = readWhen(rest.join(' '));
      if ('error' in read) return ctx.notice('warn', read.error);
      made = ctx.runtime.setWake({ prompt: read.prompt, when: { sessions: read.sessions, flag: read.flag } });
    } else {
      const words = first === 'in' ? rest : [first, ...rest];
      const seconds = parseDuration(words[0] ?? '');
      if (seconds === undefined || words.length < 2) return ctx.notice('warn', WAKE_USAGE);
      made = ctx.runtime.setWake({ prompt: words.slice(1).join(' '), afterSeconds: seconds });
    }
    if ('error' in made) return ctx.notice('warn', made.error);
    // The prompt ends the line as it was written, so what follows starts a line of its own.
    ctx.notice('info', `Set ${describeWake(made.wake, now)}\n/wake cancel ${made.wake.id} removes it.`);
  },
};

const stamp = (at: Date) => at.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** The report's Markdown: the facts to act on, every note, the message, and the log when asked for. */
function reportText(ctx: CommandContext, withLog: boolean, message: string, at: Date): string {
  const { runtime } = ctx;
  const spend = runtime.spend();
  const notes = runtime.notes();
  const lines = [
    `# Report on session ${runtime.sessionId}${runtime.name ? ` (${runtime.name})` : ''}`,
    '',
    `- Written: ${at.toISOString()}`,
    `- JamCLI: ${JAMCLI_VERSION}`,
    `- Project: ${ctx.projectRoot}`,
    `- Model: ${runtime.model.provider}:${runtime.model.model}`,
    `- Effort: ${choiceOf(runtime.thinking)}`,
    `- Cost: ${spend.requests ? `${formatUsd(spend.cost)}${spend.unpriced ? ' or more' : ''} over ${spend.requests} request${spend.requests === 1 ? '' : 's'}` : 'nothing yet'}`,
    '',
    '## Context',
    '',
    contextReport(runtime.contextUsage(), runtime.session.messages.length),
    '',
    '## Message',
    '',
    message || '(none)',
    '',
    `## Tester notes (${notes.length})`,
    '',
    ...(notes.length ? notes.map((note) => `- ${new Date(note.ts).toISOString()} ${note.text}`) : ['(none)']),
  ];
  if (withLog) {
    const file = sessionFileFor(ctx.projectRoot, runtime.sessionId);
    lines.push('', '## Session log', '', `The log file: ${file}`, '', fs.existsSync(file) ? transcriptToMarkdown(readTranscript(file), { id: runtime.sessionId }) : '(nothing recorded yet)');
  }
  return `${lines.join('\n')}\n`;
}

export const report: SlashCommand = {
  name: 'report',
  args: '[message]',
  summary: "Write a report of this session: its notes, model, effort, and context, with the log if you like",
  source: 'built-in',
  run(ctx, args) {
    const write = (withLog: boolean, message: string) => {
      const at = new Date();
      const text = reportText(ctx, withLog, message.trim(), at);
      const dir = path.join(ensureProjectStateDir(ctx.projectRoot), 'reports');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${ctx.runtime.sessionId}-${stamp(at)}.md`);
      fs.writeFileSync(file, text, 'utf8');
      const notes = ctx.runtime.notes().length;
      // Where there is no screen to open the file on, the report itself is the answer.
      if (!ctx.opensSessions) ctx.show(text);
      ctx.notice('info', `Wrote ${path.relative(ctx.projectRoot, file)}: ${notes} note${notes === 1 ? '' : 's'}${withLog ? ', with the session log' : ''}.`);
    };
    const askMessage = (withLog: boolean) => {
      if (args.trim()) return write(withLog, args);
      ctx.choose({
        title: 'A message for the report (optional)',
        items: [{ key: 'none', label: 'No message' }],
        freeText: 'your message; Enter on an empty line skips it',
        empty: 'No choices.',
        choose: (item) => write(withLog, item.key === 'none' ? '' : (item.value ?? item.label)),
      });
    };
    ctx.choose({
      title: 'Include the session log in the report?',
      items: [
        { key: 'no', label: 'Without the log' },
        { key: 'yes', label: 'With the log', detail: 'the session as Markdown, and where its log file is' },
      ],
      empty: 'No choices.',
      choose: (item) => askMessage(item.key === 'yes'),
    });
  },
};
