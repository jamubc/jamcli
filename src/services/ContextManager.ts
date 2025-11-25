import { Message } from '../store/index.js';
import { ContextManagementConfig } from '../types/config.js';
import { countTotalTokens } from '../utils/tokenUtils.js';
import { ILLMProvider } from './LLMProvider.js';

export class ContextManager {
  static async manageContext(
    messages: Message[],
    config: ContextManagementConfig | undefined,
    provider: ILLMProvider,
    modelId: string,
    force: boolean = false
  ): Promise<{ context: Message[]; systemNotice?: string }> {
    // If force is true, we proceed even if disabled or empty (though empty usually returns early)
    // If force is false, check config enabled and message length
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
        systemNotice: `ℹ Context truncated to fit limit (${totalTokens} -> ${truncated.tokens} tokens, limit ${maxTokens}).`,
      };
    }

    if (strategy === 'summarize') {
      return await this.summarizeContext(messages, provider, modelId, totalTokens, maxTokens, thresholdLimit);
    }

    return { context: messages };
  }

  private static truncateContext(messages: Message[], limit: number): { context: Message[]; tokens: number } {
    const systemPrompt = messages[0]?.role === 'system' ? messages[0] : null;
    const systemTokens = systemPrompt ? countTotalTokens([systemPrompt]) : 0;
    const remainingLimit = limit - systemTokens;
    const contextMessages: Message[] = [];
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
    messages: Message[],
    provider: ILLMProvider,
    modelId: string,
    currentTokens: number,
    maxTokens: number,
    thresholdLimit: number
  ): Promise<{ context: Message[]; systemNotice?: string }> {
    const systemPrompt = messages[0]?.role === 'system' ? messages[0] : null;
    const startIndex = systemPrompt ? 1 : 0;
    // Keep more messages if possible, but ensure we condense at least something
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
    
    const summaryInput: Message[] = [
        { role: 'user', content: `${summaryPrompt}\n\n${toSummarize.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}`, timestamp: Date.now() }
    ];

    try {
        const result = await provider.complete(summaryInput, { model: modelId, temperature: 0.3 });
        const summary = result.content;
        const summaryMessage: Message = {
            role: 'system',
            content: `[Context Summary]:\n${summary}`,
            timestamp: Date.now()
        };

        const newContext: Message[] = [];
        if (systemPrompt) newContext.push(systemPrompt);
        newContext.push(summaryMessage);
        newContext.push(...recentMessages);

        let newTokens = countTotalTokens(newContext);
        let systemNotice = `ℹ Context compressed (${currentTokens} -> ${newTokens} tokens).`;

        // Only warn about threshold if we were actually over it (not forced)
        if (currentTokens > thresholdLimit) {
             systemNotice = `ℹ IMPORTANT: Conversation exceeded limit (${thresholdLimit}/${maxTokens}). Context compressed (${currentTokens} -> ${newTokens} tokens).`;
        }

        if (newTokens > maxTokens) {
          const truncated = this.truncateContext(newContext, maxTokens);
          newTokens = truncated.tokens;
          return {
            context: truncated.context,
            systemNotice: `${systemNotice}\nℹ Summary was still above limit; truncated to ${newTokens} tokens.`,
          };
        }

        return {
            context: newContext,
            systemNotice,
        };

    } catch (error) {
        console.error("Failed to summarize context", error);
        return { context: messages, systemNotice: "⚠ Failed to compress context." };
    }
  }
}
