import type { ElicitationAnswer, ElicitField, ElicitValue } from '../../core/mcp/connect.js';
import type { AgentEvent } from '../../core/types.js';
import { openBrowser } from '../../cli/mcp.js';
import type { CommandContext } from './commands.js';
import type { PickItem } from './Picker.js';

export type ElicitationEvent = Extract<AgentEvent, { type: 'elicitation_request' }>;

/** A field's choices: its enum, yes or no, or nothing when the answer is typed. */
function choicesFor(field: ElicitField): PickItem[] | undefined {
  if (field.enum?.length) return field.enum.map((value) => ({ key: `v:${value}`, label: value, value, ...(field.default === value ? { current: true } : {}) }));
  if (field.type === 'boolean') return [{ key: 'v:true', label: 'Yes', value: 'true' }, { key: 'v:false', label: 'No', value: 'false' }];
  return undefined;
}

/** The typed or chosen text as the field's type wants it, or why it is not one. */
function valueFor(field: ElicitField, text: string): ElicitValue | { problem: string } {
  if (field.type === 'boolean') return text === 'true';
  if (field.type === 'number' || field.type === 'integer') {
    const number = Number(text);
    if (!text.trim() || Number.isNaN(number) || (field.type === 'integer' && !Number.isInteger(number))) return { problem: `"${text}" is not ${field.type === 'integer' ? 'a whole number' : 'a number'}.` };
    return number;
  }
  return text;
}

/**
 * Ask the person what an MCP server asked for, one field at a time, then whether to send
 * the answers. A page to open is shown with its address first. Escape at any point
 * cancels, and the server hears so.
 */
export function answerElicitation(ctx: CommandContext, event: ElicitationEvent): void {
  const { request } = event;
  const finish = (answer: ElicitationAnswer, said: string) => {
    event.respond(answer);
    ctx.notice('info', said);
  };
  const cancelled = () => finish({ action: 'cancel' }, `Cancelled what ${request.server} asked for.`);

  if (request.mode === 'url') {
    ctx.pick({
      title: `${request.server} asks you to open a page`,
      note: `${request.message}\n${request.url}`,
      items: [
        { key: 'open', label: 'Open it in the browser', detail: 'the address is shown above; check it first' },
        { key: 'decline', label: 'Decline', detail: 'the server is told no' },
      ],
      empty: 'Nothing to choose.',
      hint: 'Enter chooses · Escape cancels',
      dismissed: cancelled,
      choose: async (item) => {
        if (item.key !== 'open') return finish({ action: 'decline' }, `Declined to open the page ${request.server} asked for.`);
        await openBrowser(new URL(request.url));
        finish({ action: 'accept' }, `Opened ${request.url} for ${request.server}.`);
      },
    });
    return;
  }

  const fields = Object.entries(request.schema.properties);
  const required = new Set(request.schema.required ?? []);
  const answers: Record<string, ElicitValue> = {};
  const ask = (index: number, problem?: string): void => {
    if (index >= fields.length) return confirm();
    const [name, field] = fields[index];
    const choices = choicesFor(field);
    const optional = !required.has(name);
    ctx.pick({
      title: `${request.server} asks: ${field.title ?? name}${optional ? ' (optional)' : ''}`,
      note: [problem, index === 0 ? request.message : undefined, field.description].filter(Boolean).join('\n'),
      items: [...(choices ?? []), ...(optional ? [{ key: 'skip', label: 'Leave it out' }] : [])],
      ...(choices ? {} : { freeText: `Enter uses what you typed${field.type === 'string' ? '' : `, as ${field.type === 'integer' ? 'a whole number' : 'a number'}`}` }),
      empty: 'Nothing to choose.',
      hint: `${index + 1} of ${fields.length} · Enter chooses · Escape cancels`,
      dismissed: cancelled,
      choose: (item) => {
        if (item.key === 'skip') return ask(index + 1);
        const value = valueFor(field, item.value ?? item.label);
        if (typeof value === 'object' && !Array.isArray(value)) return ask(index, value.problem);
        answers[name] = value;
        ask(index + 1);
      },
    });
  };
  const confirm = () => {
    const lines = Object.entries(answers).map(([name, value]) => `${request.schema.properties[name]?.title ?? name}: ${String(value)}`);
    ctx.pick({
      title: `Send these answers to ${request.server}?`,
      note: lines.join('\n') || '(no answers)',
      items: [
        { key: 'send', label: 'Send them' },
        { key: 'decline', label: 'Decline', detail: 'send nothing; the server is told no' },
      ],
      empty: 'Nothing to choose.',
      hint: 'Enter chooses · Escape cancels',
      dismissed: cancelled,
      choose: (item) =>
        item.key === 'send' ? finish({ action: 'accept', content: answers }, `Sent ${request.server} what it asked for.`) : finish({ action: 'decline' }, `Declined what ${request.server} asked for.`),
    });
  };
  ask(0);
}
