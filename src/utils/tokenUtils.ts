export const estimateTokens = (text: string): number => {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  // Rough estimation: ~4 characters per token
  return Math.max(1, Math.ceil(trimmed.length / 4));
};

export const countMessageTokens = (message: { content: string }): number => {
  return estimateTokens(message.content);
};

export const countTotalTokens = (messages: { content: string }[]): number => {
  return messages.reduce((acc, msg) => acc + countMessageTokens(msg), 0);
};
