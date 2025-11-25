import fs from 'fs';
import path from 'path';
import os from 'os';

const AT_REF_REGEX = /(?<!\S)@([^\s]+)/g;
const MAX_FILE_BYTES = 192 * 1024; // 192 KB per file
const MAX_DIRECTORY_ENTRIES = 128;
const MAX_OPERATIONS = 12;

export interface AtReference {
  raw: string;
  displayPath: string;
  absolutePath: string;
  type: 'file' | 'directory';
  content: string;
  truncated: boolean;
  size?: number;
  listingCount?: number;
}

export interface MissingAtReference {
  raw: string;
  absolutePath: string;
  reason: string;
}

export type AtReferenceOperation =
  | { kind: 'reference'; index: number; reference: AtReference }
  | { kind: 'missing'; index: number; missing: MissingAtReference };

function normalizeToken(token: string): string {
  let value = token.trim();
  if (!value) return value;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (value && value !== '/' && !value.endsWith('/')) {
    value = value.replace(/[.,;:!?]+$/, '');
  }
  return value;
}

function looksLikePath(value: string) {
  if (!value) return false;
  if (value.startsWith('./') || value.startsWith('../') || value.startsWith('/') || value.startsWith('~/')) {
    return true;
  }
  if (value.includes('/') || value.includes('\\')) {
    return true;
  }
  if (value.includes('.')) {
    return true;
  }
  return false;
}

function expandHome(value: string) {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function getDisplayPath(baseDir: string, target: string) {
  const relative = path.relative(baseDir, target);
  if (!relative) {
    return '.';
  }
  if (relative.startsWith('..')) {
    return target;
  }
  return relative;
}

async function readFileSnippet(filePath: string, sizeLimit: number, totalSize: number) {
  const handle = await fs.promises.open(filePath, 'r');
  const toRead = Math.min(sizeLimit, Number.isFinite(totalSize) ? totalSize : sizeLimit);
  const buffer = Buffer.alloc(toRead);
  const { bytesRead } = await handle.read(buffer, 0, toRead, 0);
  await handle.close();
  const text = buffer.slice(0, bytesRead).toString('utf-8');
  const truncated = bytesRead < (totalSize || 0);
  return { text, truncated, size: Number.isFinite(totalSize) ? totalSize : bytesRead };
}

export async function resolveAtReferences(
  message: string,
  baseDir: string
): Promise<AtReferenceOperation[]> {
  if (!message.includes('@')) {
    return [];
  }

  const normalizedBase = path.resolve(baseDir);
  const operations: AtReferenceOperation[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  const regex = new RegExp(AT_REF_REGEX);
  while ((match = regex.exec(message)) !== null) {
    if (operations.length >= MAX_OPERATIONS) {
      break;
    }

    const rawToken = match[0];
    const token = normalizeToken(match[1]);
    if (!token || !looksLikePath(token)) {
      continue;
    }

    const expanded = expandHome(token);
    const absolutePath = path.resolve(normalizedBase, expanded);
    const normalizedPath = path.normalize(absolutePath);
    if (seen.has(normalizedPath)) {
      continue;
    }
    seen.add(normalizedPath);

    try {
      const stats = await fs.promises.stat(normalizedPath);
      if (stats.isDirectory()) {
        const entries = await fs.promises.readdir(normalizedPath, { withFileTypes: true });
        const listed = entries.slice(0, MAX_DIRECTORY_ENTRIES);
        const listing =
          listed.length > 0
            ? listed.map((entry) => `${entry.isDirectory() ? '📁' : '📄'} ${entry.name}`).join('\n')
            : '  <empty directory>';
        const truncated = entries.length > listed.length;
        const content = [
          `Directory listing for ${getDisplayPath(normalizedBase, normalizedPath)} (${entries.length} entries):`,
          '',
          listing,
          truncated ? `… and ${entries.length - listed.length} more entries.` : '',
        ]
          .filter(Boolean)
          .join('\n');

        operations.push({
          kind: 'reference',
          index: match.index,
          reference: {
            raw: rawToken,
            absolutePath: normalizedPath,
            displayPath: getDisplayPath(normalizedBase, normalizedPath),
            type: 'directory',
            content,
            truncated,
            listingCount: entries.length,
          },
        });
      } else if (stats.isFile()) {
        const snippet = await readFileSnippet(normalizedPath, MAX_FILE_BYTES, Number.isFinite(stats.size) ? stats.size : 0);
        operations.push({
          kind: 'reference',
          index: match.index,
          reference: {
            raw: rawToken,
            absolutePath: normalizedPath,
            displayPath: getDisplayPath(normalizedBase, normalizedPath),
            type: 'file',
            content: snippet.text,
            truncated: snippet.truncated,
            size: snippet.size,
          },
        });
      } else {
        operations.push({
          kind: 'missing',
          index: match.index,
          missing: {
            raw: rawToken,
            absolutePath: normalizedPath,
            reason: 'Path is not a file or directory.',
          },
        });
      }
    } catch (error: any) {
      operations.push({
        kind: 'missing',
        index: match.index,
        missing: {
          raw: rawToken,
          absolutePath: normalizedPath,
          reason: error?.message || 'Unable to access path.',
        },
      });
    }
  }

  return operations;
}
