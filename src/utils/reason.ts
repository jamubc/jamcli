/** An error's message as a clause to set inside a sentence: its own closing full stop taken off, so the sentence ends once. */
export const reasonOf = (error: unknown): string => String((error as { message?: unknown } | undefined)?.message ?? error).trim().replace(/[.]+$/, '');
