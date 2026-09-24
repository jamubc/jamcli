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

const heading = (message: ChatMessage): string => {
  if (message.role === 'assistant') return message.model ? `## Assistant (${message.model})` : '## Assistant';
  return `## ${message.role.charAt(0).toUpperCase()}${message.role.slice(1)}`;
};

const renderMessage = (message: ChatMessage, toolNames: Map<string, string>): string[] => {
  if (message.role === 'tool') {
    const id = message.tool_call_id ?? '';
    const tool = message.toolName ?? toolNames.get(id) ?? 'tool';
    const label = [`\`${tool}\``, ...(id ? [`\`${id}\``] : []), ...(message.toolStatus ? [`(${message.toolStatus})`] : [])];
    return [`### Result: ${label.join(' ')}`, fenced(message.content ?? '', 'text')];
  }
  const out = [heading(message)];
  if (message.reasoning) {
    out.push(`<details><summary>Reasoning</summary>\n\n${message.reasoning}\n\n</details>`);
  }
  if (message.content) out.push(message.content);
  for (const call of message.tool_calls ?? []) {
    if (call.id) toolNames.set(call.id, call.function.name);
    out.push(`**Tool call** \`${call.function.name}\`${call.id ? ` \`${call.id}\`` : ''}`, fenced(prettyArguments(call.function.arguments), 'json'));
  }
  return out;
};

/**
 * The session as Markdown: every message, tool call, result with its status, approval
 * decision, notice, compaction, model switch, and turn end, in the order they happened.
 */
export function transcriptToMarkdown(events: TranscriptEvent[], options: { id?: string; title?: string } = {}): string {
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
  const spend = CostLedger.fromEvents(events).summary();
  if (spend.requests) facts.push(`- Cost: ${describeSpend(spend)}`);
  out.push(facts.join('\n'), '---');

  const toolNames = new Map<string, string>();
  for (const event of events) {
    switch (event.type) {
      case 'message':
        out.push(...renderMessage(event.message, toolNames));
        break;
      case 'approval': {
        const verdict = event.allow ? `allowed ${event.scope === 'once' ? 'once' : `for this ${event.scope}`}` : 'denied';
        const rule = event.rule ? `, rule \`${event.rule}\`` : event.reason ? `, because ${event.reason}` : '';
        const feedback = event.feedback ? `\n> Feedback: ${event.feedback}` : '';
        out.push(`> **Approval**: \`${event.tool}\` \`${event.callId}\` ${verdict} by ${event.by} on ${event.surface}${rule}${feedback}`);
        break;
      }
      case 'notice':
        out.push(`> **Notice** (${event.level}${event.code ? `, ${event.code}` : ''}): ${event.message}`);
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
      case 'end':
        out.push(`*Turn ended: ${event.status}*`, '---');
        break;
      default:
        break;
    }
  }
  return `${out.join('\n\n')}\n`;
}
