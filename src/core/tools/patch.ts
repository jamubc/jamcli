import fs from 'fs-extra';
import path from 'path';
import { applyPatch as applyStructuredPatch, parsePatch } from 'diff';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { resolveProjectPath } from './paths.js';
import { detectLineEnding, withLineEnding } from './textEdit.js';

type FileOp = 'add' | 'modify' | 'delete';

interface PlannedChange {
  rel: string;
  absolute: string;
  op: FileOp;
  next: string;
  added: number;
  removed: number;
}

const stripPrefix = (name: string | undefined): string | undefined => {
  if (!name) return undefined;
  const trimmed = name.split('\t')[0].trim();
  if (trimmed === '/dev/null') return trimmed;
  return trimmed.replace(/^[ab]\//, '');
};

/**
 * Apply a unified diff that may touch several files. Every hunk is checked against the
 * files on disk before anything is written, and the whole patch applies or none of it
 * does. Files keep their line endings.
 */
export async function applyPatchRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const patchText = args.patch;
  if (typeof patchText !== 'string' || !patchText.trim()) {
    throw new Error('apply_patch requires a "patch" containing a unified diff.');
  }
  const parsed = parsePatch(patchText);
  if (!parsed.length || parsed.every((entry) => !entry.hunks.length)) {
    throw new Error('apply_patch found no hunks. Send a unified diff with @@ headers.');
  }

  const planned: PlannedChange[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of parsed.entries()) {
    if (!entry.hunks.length) continue;
    const oldName = stripPrefix(entry.oldFileName);
    const newName = stripPrefix(entry.newFileName);
    const creating = oldName === '/dev/null';
    const deleting = newName === '/dev/null';
    const target = (deleting ? oldName : newName) ?? oldName ?? (typeof args.path === 'string' ? args.path : undefined);
    if (!target || target === '/dev/null') {
      throw new Error(`Patch section ${index + 1} names no file. Add ---/+++ headers or pass "path".`);
    }
    const absolute = resolveProjectPath(ctx.projectRoot, target, { additionalRoots: ctx.additionalRoots });
    const rel = path.relative(ctx.projectRoot, absolute) || target;
    if (seen.has(rel)) throw new Error(`Patch touches ${rel} more than once; combine its hunks into one section.`);
    seen.add(rel);

    const exists = await fs.pathExists(absolute);
    if (creating && exists) throw new Error(`Patch creates ${rel}, but it already exists.`);
    if (!creating && !exists) throw new Error(`Patch modifies ${rel}, but it does not exist.`);
    const current = exists ? await fs.readFile(absolute, 'utf-8') : '';
    const eol = detectLineEnding(current);
    const next = applyStructuredPatch(current.replace(/\r\n/g, '\n'), entry);
    if (next === false) {
      const hunk = entry.hunks[0];
      throw new Error(
        `Patch does not apply to ${rel}: the context of the hunk at line ${hunk.oldStart} does not match the file. Read the file again and regenerate the patch. Nothing was written.`
      );
    }
    let added = 0;
    let removed = 0;
    for (const hunk of entry.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) added += 1;
        else if (line.startsWith('-')) removed += 1;
      }
    }
    planned.push({
      rel,
      absolute,
      op: creating ? 'add' : deleting ? 'delete' : 'modify',
      next: eol === '\r\n' ? withLineEnding(next, '\r\n') : next,
      added,
      removed,
    });
  }

  for (const change of planned) {
    if (change.op === 'delete') {
      await fs.remove(change.absolute);
    } else {
      await fs.ensureDir(path.dirname(change.absolute));
      await fs.writeFile(change.absolute, change.next, 'utf-8');
    }
  }

  const letter: Record<FileOp, string> = { add: 'A', modify: 'M', delete: 'D' };
  const summary = planned.map((change) => `${letter[change.op]} ${change.rel} (+${change.added} -${change.removed})`);
  return {
    output: `Applied the patch to ${planned.length} file${planned.length === 1 ? '' : 's'}:\n${summary.join('\n')}`,
    metadata: {
      files: planned.map(({ rel, op, added, removed }) => ({ path: rel, op, added, removed })),
      diff: patchText,
    },
  };
}

const applyPatchSchema: JsonSchema = {
  type: 'object',
  properties: {
    patch: {
      type: 'string',
      description:
        'A unified diff. It may cover several files, each with ---/+++ headers; use /dev/null to create or delete a file. It applies completely or not at all.',
    },
    path: { type: 'string', description: 'The file to patch when the diff has no file headers.' },
  },
  required: ['patch'],
  additionalProperties: false,
};

export const APPLY_PATCH_TOOL: RegisteredTool = {
  name: 'apply_patch',
  description:
    'Apply a unified diff across one or more files. Every hunk is verified before anything is written; for a single targeted change, edit is simpler.',
  inputSchema: applyPatchSchema,
  policy: 'write',
  runner: applyPatchRunner,
};
