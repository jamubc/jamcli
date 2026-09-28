import path from 'path';
import type { ChatMessage } from '../types.js';
import type { TranscriptEvent } from './events.js';
import { CostLedger, describeSpend, formatUsd } from '../catalog/cost.js';

/** A fence longer than any run of backticks in the text, so the text cannot close it. */
export const fenced = (text: string, language = ''): string => {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text.replace(/\n$/, '')}\n${fence}`;
};

const prettyArguments = (raw: unknown): string => {
  if (typeof raw !== 'string') return JSON.stringify(raw ?? {}, null, 2);
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

/** Text for reading: JSON indented, anything else as it is. The log keeps it as it was. */
const readable = (text: string): string => {
  try {
    return fenced(JSON.stringify(JSON.parse(text), null, 2), 'json');
  } catch {
    return fenced(text, 'text');
  }
};

const heading = (message: ChatMessage): string => {
  if (message.role === 'assistant') return message.model ? `## Assistant (${message.model})` : '## Assistant';
  return `## ${message.role.charAt(0).toUpperCase()}${message.role.slice(1)}`;
};

const renderMessage = (message: ChatMessage, toolNames: Map<string, string>, debug: boolean): string[] => {
  if (message.role === 'tool') {
    const id = message.tool_call_id ?? '';
    const tool = message.toolName ?? toolNames.get(id) ?? 'tool';
    const label = [`\`${tool}\``, ...(id ? [`\`${id}\``] : []), ...(message.toolStatus ? [`(${message.toolStatus})`] : [])];
    return [`### Result: ${label.join(' ')}`, fenced(message.content ?? '', 'text')];
  }
  const out = [heading(message)];
  // Reasoning is the bulk of a session and rarely what a reader wants; the debug copy keeps it.
  if (message.reasoning && debug) {
    out.push(`<details><summary>Reasoning</summary>\n\n${message.reasoning}\n\n</details>`);
  }
  if (message.content) out.push(message.content);
  for (const call of message.tool_calls ?? []) {
    if (call.id) toolNames.set(call.id, call.function.name);
    out.push(`**Tool call** \`${call.function.name}\`${call.id ? ` \`${call.id}\`` : ''}`, fenced(prettyArguments(call.function.arguments), 'json'));
  }
  return out;
};

/** An event's time in UTC, with its date when that is not the day the session began. */
const clock = (ts: number, day: string): string => {
  const iso = new Date(ts).toISOString();
  return iso.slice(0, 10) === day ? iso.slice(11, 19) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
};

/** How long a turn took, for people: tenths of a second under a minute. */
const took = (ms: number): string => {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
};

/** The time added to the first line of what an event rendered, inside an italic line's marks. */
const stamp = (text: string, time: string): string => {
  const [first, ...rest] = text.split('\n');
  const timed = /^\*[^*].*\*$/.test(first) ? `${first.slice(0, -1)} · ${time}*` : `${first} · ${time}`;
  return [timed, ...rest].join('\n');
};

/**
 * The session as Markdown: every message, tool call, result with its status, approval
 * decision, notice, compaction, model switch, and turn end, in the order they happened,
 * each with its time, and each turn end with how long the turn took. With `debug`, also the
 * model's reasoning, what each request carried besides the conversation, the system prompt
 * and the tool definitions as sent, and what a notice kept for the record, such as a
 * result the trust gate withheld.
 */
export function transcriptToMarkdown(events: TranscriptEvent[], options: { id?: string; title?: string; debug?: boolean } = {}): string {
  const header = events.find((event) => event.type === 'session');
  const id = options.id ?? header?.id ?? 'session';
  const messages = events.filter((event) => event.type === 'message').length;
  const tokens = events.reduce((sum, event) => sum + (event.type === 'usage' && !event.delegated ? event.usage.total_tokens || 0 : 0), 0);
  const out: string[] = [`# ${options.title ?? `Session ${id}`}`];

  const facts = [`- Session: \`${id}\``];
  if (header) {
    facts.push(`- Project: ${path.basename(header.projectRoot)} (\`${header.projectRoot}\`)`);
    facts.push(`- Started: ${new Date(header.ts).toISOString()} on ${header.surface}, JamCLI ${header.jamcli}`);
    if (header.parent) facts.push(`- Forked from: \`${header.parent.session}\` at event ${header.parent.event}`);
    if (header.permissionMode) facts.push(`- Permission mode: ${header.permissionMode}`);
  }
  facts.push(`- Messages: ${messages}`, `- Tokens: ${tokens}`);
  const notes = events.filter((event) => event.type === 'note').length;
  if (notes) facts.push(`- Tester notes: ${notes}, marked **HUMAN TESTER** below where they were planted`);
  const reasoning = events.filter((event) => event.type === 'message' && event.message.reasoning).length;
  if (reasoning && !options.debug) facts.push(`- Reasoning: ${reasoning} block${reasoning === 1 ? '' : 's'}, left out here; \`/copy debug\` shows it, and the session log keeps it`);
  const spend = CostLedger.fromEvents(events).summary();
  if (spend.requests) facts.push(`- Cost: ${describeSpend(spend)}`);
  facts.push('- Times are UTC');
  out.push(facts.join('\n'), '---');

  const day = new Date(header?.ts ?? events[0]?.ts ?? 0).toISOString().slice(0, 10);
  const toolNames = new Map<string, string>();
  let turnStart: number | undefined;
  for (const event of events) {
    const before = out.length;
    switch (event.type) {
      case 'message':
        if (event.message.role === 'user') turnStart = event.ts;
        out.push(...renderMessage(event.message, toolNames, Boolean(options.debug)));
        break;
      case 'approval': {
        const verdict = event.allow ? `allowed ${event.scope === 'once' ? 'once' : `for this ${event.scope}`}` : 'denied';
        const rule = event.rule ? `, rule \`${event.rule}\`` : event.reason ? `, because ${event.reason}` : '';
        const feedback = event.feedback ? `\n> Feedback: ${event.feedback}` : '';
        out.push(`> **Approval**: \`${event.tool}\` \`${event.callId}\` ${verdict} by ${event.by} on ${event.surface}${rule}${feedback}`);
        break;
      }
      case 'note':
        // A tester's flag stands out from the run around it: it was planted by a person, at this point, and the model never saw it.
        out.push(`> ⚑ **HUMAN TESTER** (not sent to the model): ${event.text}`);
        break;
      case 'notice':
        out.push(`> **Notice** (${event.level}${event.code ? `, ${event.code}` : ''}): ${event.message}`);
        if (options.debug && event.detail !== undefined) out.push('What it concerns, kept for the record and not sent to the model:', fenced(event.detail, 'text'));
        break;
      case 'screening': {
        if (!options.debug) break;
        out.push(`### Trust gate${event.model ? ` (${event.model})` : ''}`);
        if (event.sent !== undefined) out.push('Sent to the classifier:', readable(event.sent));
        if (event.answered !== undefined) out.push('It answered:', readable(event.answered));
        if (event.error !== undefined) out.push(`The request failed, so every result was kept: ${event.error}`);
        const fate = (result: (typeof event.results)[number], index: number) => {
          const verdict = result.verdict
            ? `relevance ${result.verdict.relevance}, injection ${result.verdict.injection ? 'yes' : 'no'}${result.verdict.reason ? `, ${result.verdict.reason}` : ''}`
            : 'no verdict';
          return `${index + 1}. \`${result.tool}\`: ${result.withheld ? 'withheld' : 'kept'}, ${verdict}${result.duplicateOf !== undefined ? `, as a duplicate of ${result.duplicateOf + 1}` : ''}`;
        };
        if (event.results.length) out.push(event.results.map(fate).join('\n'));
        break;
      }
      case 'context':
        if (!options.debug) break;
        if (event.system !== undefined) out.push('### Sent to the model: system prompt', fenced(event.system, 'text'));
        if (event.tools?.length) {
          out.push(`### Sent to the model: tools (${event.tools.length})`);
          for (const tool of event.tools) {
            out.push(`\`${tool.function.name}\`${tool.function.description ? `: ${tool.function.description}` : ''}`, fenced(JSON.stringify(tool.function.parameters ?? {}, null, 2), 'json'));
          }
        }
        if (event.system === undefined && !event.tools?.length) out.push('*Sent to the model: no system prompt and no tools*');
        break;
      case 'usage': {
        const { prompt_tokens: prompt, completion_tokens: completion } = event.usage;
        const cost = event.cost === undefined ? ', unpriced' : `, ${formatUsd(event.cost)}`;
        const by = [event.model, event.delegated ? `delegated session \`${event.delegated}\`` : undefined].filter(Boolean).join(', ');
        out.push(`*Usage${by ? ` (${by})` : ''}: ${prompt} prompt and ${completion} completion tokens${cost}*`);
        break;
      }
      case 'model':
        out.push(`*Model changed${event.from ? ` from ${event.from}` : ''} to ${event.to}*`);
        break;
      case 'permission_mode':
        out.push(`*Permission mode changed from ${event.from} to ${event.to}*`);
        break;
      case 'compaction':
        out.push(
          `> **Compaction**${event.trigger === 'manual' ? ' (requested)' : ''}: ${event.replaced} messages ${event.strategy === 'drop' ? 'left out' : 'summarized'}, ${event.before} to ${event.after} tokens.`,
          fenced(event.summary, 'text')
        );
        break;
      case 'checkpoint':
        out.push(`*Checkpoint \`${event.ref}\`${event.files?.length ? `: ${event.files.join(', ')}` : ''}*`);
        break;
      case 'gate':
        out.push(`> **Gate** ${event.name} (${event.tier}${event.byModel ? ', run by the model' : ''}): ${event.status}${event.tree ? ` on tree \`${event.tree.slice(0, 7)}\`` : ''} in ${took(event.durationMs)}`);
        if (event.status === 'failed' && event.shaped) out.push(fenced(event.shaped, 'text'));
        break;
      case 'elision':
        if (options.debug) out.push(`*Elided message ${event.message} (${event.stage}): ${event.tokensRemoved} tokens*`);
        break;
      case 'steer':
        out.push(`> **Harness** (${event.handler}): ${event.detail}`);
        break;
      case 'handoff':
        out.push(`*Handoff written to \`${event.path}\` (${event.reason})*`);
        break;
      case 'end':
        out.push(`*Turn ended: ${event.status}${turnStart === undefined ? '' : `, after ${took(event.ts - turnStart)}`}*`, '---');
        turnStart = undefined;
        break;
      default:
        break;
    }
    if (out.length > before && event.type !== 'session') out[before] = stamp(out[before], clock(event.ts, day));
  }
  return `${out.join('\n\n')}\n`;
}
