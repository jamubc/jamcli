import { resolveAtReferences, type AtReference } from '../../utils/atReferences.js';
import { fenced } from '../transcript/markdown.js';
import type { Redactor } from '../redact.js';

/** Reads MCP resources for `@server:uri` references. */
export interface ResourceReader {
  servers(): Promise<string[]>;
  read(server: string, uri: string): Promise<string>;
}

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
export async function expandReferences(prompt: string, baseDir: string, redact: Redactor, resources?: ResourceReader): Promise<ExpandedPrompt> {
  const blocks: string[] = [];
  const notices: string[] = [];
  // `@server:uri` names an MCP server's resource; everything else is a path.
  let paths = prompt;
  if (resources && prompt.includes('@')) {
    const servers = new Set(await resources.servers());
    const seen = new Set<string>();
    for (const match of prompt.matchAll(/(?<!\S)@([A-Za-z0-9_.-]+):(\S+)/g)) {
      if (!servers.has(match[1])) continue;
      paths = paths.split(match[0]).join('');
      if (seen.has(match[0])) continue;
      seen.add(match[0]);
      try {
        blocks.push(`Resource ${match[2]} from MCP server ${match[1]}:\n${fenced(redact(await resources.read(match[1], match[2])))}`);
      } catch (error: any) {
        notices.push(`Could not include ${match[0]}: ${error?.message ?? error}`);
      }
    }
  }
  const operations = await resolveAtReferences(paths, baseDir);
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
