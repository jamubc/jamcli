import fs from 'fs';
import { ensureDir, pathExists } from '../../utils/fsx.js';
import path from 'path';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { resolveProjectPath } from './paths.js';

const writeFileSchema: JsonSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to write, relative to the project root.' },
    content: { type: 'string', description: 'Full file content to write.' },
    create_directories: {
      type: 'boolean',
      description: 'Create missing parent directories. Defaults to true.',
    },
    overwrite: {
      type: 'boolean',
      description: 'Required when the file already exists: without it the write is refused.',
    },
  },
  required: ['path', 'content'],
  additionalProperties: false,
};

export async function writeFile(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const relative = String(args.path ?? '');
  const content = String(args.content ?? '');
  const target = resolveProjectPath(ctx.projectRoot, relative);
  const exists = await pathExists(target);

  if (exists) {
    const stat = await fs.promises.stat(target);
    if (stat.isDirectory()) {
      return { output: `Refused: ${relative} is a directory.` };
    }
    if (!args.overwrite) {
      const current = await fs.promises.readFile(target, 'utf8').catch(() => '');
      return {
        output: [
          `Refused to overwrite ${relative}: it already exists (${current.length} chars).`,
          'Read it first and pass overwrite: true, or use edit for a targeted change.',
        ].join('\n'),
      };
    }
  }

  if (args.create_directories !== false) {
    await ensureDir(path.dirname(target));
  }

  await fs.promises.writeFile(target, content, 'utf8');
  const bytes = Buffer.byteLength(content, 'utf8');
  return { output: `${exists ? 'Overwrote' : 'Created'} ${relative} (${bytes} bytes).` };
}

export const WRITE_FILE_TOOL: RegisteredTool = {
  name: 'write_file',
  description: 'Create a file, or overwrite one explicitly. Refuses a silent overwrite.',
  inputSchema: writeFileSchema,
  policy: 'write',
  runner: writeFile,
};
