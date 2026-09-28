import { describeCall } from '../approval.js';
import type { ChatMessage, ToolCall } from '../types.js';

/** Calls listed in a digest; a run that made more shows the latest and says how many came before. */
const MAX_CALLS = 60;
/** Narration kept: the last few things the run said between its calls. */
const MAX_NARRATION = 6;
const NARRATION_CHARS = 400;

const callOf = (raw: { id?: string; function: { name: string; arguments?: unknown } }, index: number): ToolCall => {
  let args: Record<string, unknown> = {};
  try {
    const parsed = typeof raw.function.arguments === 'string' ? JSON.parse(raw.function.arguments) : raw.function.arguments;
    if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
  } catch {
    // A call whose arguments did not parse is still listed by name.
  }
  return { id: raw.id ?? `call-${index}`, name: raw.function.name, arguments: args };
};

/**
 * What a run did, read from its own messages: what it said between calls, and each call it
 * made. A delegated run that stops for good hands this back when it cannot write a report,
 * so its parent knows what was read and asked instead of receiving nothing. Every line is a
 * fact from the log; nothing is summarized by a model.
 */
export function digestOfWork(messages: ChatMessage[]): string {
  const said = messages
    .filter((message) => message.role === 'assistant' && message.content?.trim())
    .map((message) => message.content.replace(/\s+/g, ' ').trim().slice(0, NARRATION_CHARS))
    .slice(-MAX_NARRATION);
  const calls = messages.flatMap((message) => (message.role === 'assistant' ? (message.tool_calls ?? []) : [])).map(callOf);
  const shown = calls.slice(-MAX_CALLS);
  const lines: string[] = [];
  if (said.length) lines.push('What it said as it went:', ...said.map((text) => `- ${text}`));
  if (calls.length) {
    lines.push(`${lines.length ? '\n' : ''}What it did, oldest first${calls.length > shown.length ? ` (the last ${shown.length} of ${calls.length})` : ''}:`, ...shown.map((call) => `- ${describeCall(call)}`));
  }
  return lines.join('\n');
}
