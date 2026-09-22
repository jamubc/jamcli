import type { ChatMessage } from '../types.js';
import type { ContextManagementConfig } from '../../types/config.js';
import { countTotalTokens } from '../../utils/tokenUtils.js';
import type { ChatProvider } from '../providers/types.js';

export class ContextManager {
  static async manageContext(
    messages: ChatMessage[],
    config: ContextManagementConfig | undefined,
    provider: ChatProvider,
    modelId: string,
    force: boolean = false
  ): Promise<{ context: ChatMessage[]; systemNotice?: string }> {
    if ((!config || !config.enabled) && !force) {
      return { context: messages };
    }
    if (messages.length === 0) {
      return { context: messages };
    }

    const maxTokens = Math.max(1, config?.max_tokens ?? 8000);
    const compressionThreshold = Math.min(Math.max(config?.compression_threshold ?? 0.9, 0.5), 1);
    const thresholdLimit = Math.floor(maxTokens * compressionThreshold);

    const totalTokens = countTotalTokens(messages);
    if (!force && totalTokens <= thresholdLimit) {
      return { context: messages };
    }

    const strategy = config?.strategy || 'summarize';

    if (strategy === 'truncate') {
      const truncated = this.truncateContext(messages, maxTokens);
      return {
        context: truncated.context,
        systemNotice: `Context truncated to fit limit (${totalTokens} -> ${truncated.tokens} tokens, limit ${maxTokens}).`,
      };
    }

    if (strategy === 'summarize') {
      return await this.summarizeContext(messages, provider, modelId, totalTokens, maxTokens, thresholdLimit);
    }

    return { context: messages };
  }

  private static truncateContext(messages: ChatMessage[], limit: number): { context: ChatMessage[]; tokens: number } {
    const systemPrompt = messages[0]?.role === 'system' ? messages[0] : null;
    const systemTokens = systemPrompt ? countTotalTokens([systemPrompt]) : 0;
    const remainingLimit = limit - systemTokens;
    const contextMessages: ChatMessage[] = [];
    let currentTokens = 0;

    for (let i = messages.length - 1; i >= (systemPrompt ? 1 : 0); i -= 1) {
      const msg = messages[i];
      const tokens = countTotalTokens([msg]);
      if (currentTokens + tokens <= remainingLimit) {
        contextMessages.unshift(msg);
        currentTokens += tokens;
      } else {
        break;
      }
    }

    if (systemPrompt) {
      contextMessages.unshift(systemPrompt);
    }

    return { context: contextMessages, tokens: currentTokens + systemTokens };
  }

  private static async summarizeContext(
    messages: ChatMessage[],
    provider: ChatProvider,
    modelId: string,
    currentTokens: number,
    maxTokens: number,
    thresholdLimit: number
  ): Promise<{ context: ChatMessage[]; systemNotice?: string }> {
    const systemPrompt = messages[0]?.role === 'system' ? messages[0] : null;
    const startIndex = systemPrompt ? 1 : 0;
    const KEEP_LAST = 4;

    if (messages.length - startIndex <= KEEP_LAST) {
      return { context: messages };
    }

    const endIndex = messages.length - KEEP_LAST;
    const toSummarize = messages.slice(startIndex, endIndex);
    const recentMessages = messages.slice(endIndex);

    if (toSummarize.length === 0) return { context: messages };

    const summaryPrompt = `
Please generate a structured summary of the conversation history to reduce token usage while preserving critical context for a software engineering workflow.

Your summary MUST include the following sections:

1. Primary Request and Intent
   - Capture all user's explicit requests and intents in detail.

2. Key Technical Concepts
   - List all important technical concepts, technologies, and frameworks discussed.

3. Files and Code Sections
   - Enumerate specific files and code sections examined, modified, or created.
   - Include full code snippets where applicable, especially for recent changes.
   - Pay special attention to recent messages.

Keep the summary concise but technically accurate.
`.trim();

    const summaryInput: ChatMessage[] = [
      {
        role: 'user',
        content: `${summaryPrompt}\n\n${toSummarize.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}`,
        timestamp: Date.now(),
      },
    ];

    try {
      const result = await provider.complete(summaryInput, { model: modelId, temperature: 0.3 });
      const summary = result.content;
      const summaryMessage: ChatMessage = {
        role: 'system',
        content: `[Context Summary]:\n${summary}`,
        timestamp: Date.now(),
      };

      const newContext: ChatMessage[] = [];
      if (systemPrompt) newContext.push(systemPrompt);
      newContext.push(summaryMessage);
      newContext.push(...recentMessages);

      let newTokens = countTotalTokens(newContext);
      let systemNotice = `Context compressed (${currentTokens} -> ${newTokens} tokens).`;

      if (currentTokens > thresholdLimit) {
        systemNotice = `IMPORTANT: Conversation exceeded limit (${thresholdLimit}/${maxTokens}). Context compressed (${currentTokens} -> ${newTokens} tokens).`;
      }

      if (newTokens > maxTokens) {
        const truncated = this.truncateContext(newContext, maxTokens);
        newTokens = truncated.tokens;
        return {
          context: truncated.context,
          systemNotice: `${systemNotice}\nSummary was still above limit; truncated to ${newTokens} tokens.`,
        };
      }

      return {
        context: newContext,
        systemNotice,
      };
    } catch (error) {
      console.error('Failed to summarize context', error);
      return { context: messages, systemNotice: 'Failed to compress context.' };
    }
  }
}
