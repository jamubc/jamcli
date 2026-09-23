import { resolveAtReferences, type AtReference } from '../../utils/atReferences.js';
import { fenced } from '../transcript/markdown.js';
import type { Redactor } from '../redact.js';

export interface ExpandedPrompt {
  /** The prompt with each reference's content appended, as the model and the log see it. */
  prompt: string;
  /** References that could not be included, and why. */
  notices: string[];
}

const describe = (reference: AtReference): string => {
  if (reference.type === 'directory') {
    return `Directory ${reference.displayPath} (${reference.listingCount ?? 0} entries${reference.truncated ? ', listing cut short' : ''})`;
  }
  const size = reference.size === undefined ? '' : `, ${reference.size} bytes`;
  return `File ${reference.displayPath}${size}${reference.truncated ? ', cut short' : ''}`;
};

/**
 * Expand `@path` references into the content they name. It runs in the runtime so every
 * surface sends the same prompt for the same input, and credentials in referenced files
 * are redacted like tool output.
 */
export async function expandReferences(prompt: string, baseDir: string, redact: Redactor): Promise<ExpandedPrompt> {
  const operations = await resolveAtReferences(prompt, baseDir);
  const blocks: string[] = [];
  const notices: string[] = [];
  for (const operation of operations) {
    if (operation.kind === 'missing') {
      notices.push(`Could not include ${operation.missing.raw}: ${operation.missing.reason}`);
      continue;
    }
    const reference = operation.reference;
    if (reference.type === 'file' && reference.content.includes('\u0000')) {
      notices.push(`Did not include ${reference.raw}: it is a binary file.`);
      continue;
    }
    blocks.push(`${describe(reference)}:\n${fenced(redact(reference.content))}`);
  }
  return { prompt: blocks.length ? `${prompt}\n\n${blocks.join('\n\n')}` : prompt, notices };
}
