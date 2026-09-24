import type { ChatMessage } from '../types.js';
import type { ToolDefinition } from '../providers/types.js';

/** Characters per token before a provider has reported a count to correct it. */
const CHARS_PER_TOKEN = 4;
/** What a message costs beyond its text: its role and framing. */
const MESSAGE_OVERHEAD = 4;

export const estimateText = (text: string | undefined): number => (text ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0);

const argumentsText = (value: unknown): string => (typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value));

/** Every part of a message a request can carry: its text, its reasoning, and each tool call's name and arguments. */
export function estimateMessage(message: ChatMessage): number {
  let tokens = MESSAGE_OVERHEAD + estimateText(message.content);
  if (message.reasoningBlocks?.length) {
    for (const block of message.reasoningBlocks) tokens += estimateText(block.type === 'thinking' ? block.text : block.data);
  } else {
    tokens += estimateText(message.reasoning);
  }
  for (const call of message.tool_calls ?? []) {
    tokens += estimateText(call.function?.name) + estimateText(argumentsText(call.function?.arguments));
  }
  return tokens;
}

export const estimateMessages = (messages: ChatMessage[]): number => messages.reduce((sum, message) => sum + estimateMessage(message), 0);

/** A whole request: the system prompt, the tool definitions, and the conversation. */
export function estimateRequest(request: { system?: string; tools?: ToolDefinition[]; messages: ChatMessage[] }): number {
  const system = request.system ? MESSAGE_OVERHEAD + estimateText(request.system) : 0;
  const tools = request.tools?.length ? estimateText(JSON.stringify(request.tools)) : 0;
  return system + tools + estimateMessages(request.messages);
}

/** How far a correction may move the estimate. Beyond this, a reported count is more likely wrong than the estimate. */
const MIN_RATIO = 0.5;
const MAX_RATIO = 3;

/**
 * The estimate, corrected by what the provider reported. After each request the ratio of
 * the reported prompt tokens to the estimate for that request is kept, and later
 * estimates are scaled by it, so a tokenizer that counts differently from four
 * characters a token is learned within a session.
 */
export class TokenCounter {
  private ratio = 1;

  /** The corrected estimate for a request. */
  count(request: Parameters<typeof estimateRequest>[0]): number {
    return Math.ceil(estimateRequest(request) * this.ratio);
  }

  /** Learn from a request the provider counted. Counts outside the plausible range are ignored. */
  observe(estimated: number, reported: number | undefined): void {
    if (!reported || estimated <= 0) return;
    const ratio = reported / estimated;
    if (ratio < MIN_RATIO || ratio > MAX_RATIO) return;
    this.ratio = ratio;
  }

  get correction(): number {
    return this.ratio;
  }
}
