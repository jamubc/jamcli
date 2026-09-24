import fs from 'fs';
import { ensureDir } from '../utils/fsx.js';
import path from 'path';
import { applyPatch } from 'diff';

export class FileSystemService {
  private baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
  }

  async readFile(filePath: string): Promise<string> {
    return fs.promises.readFile(this.resolvePath(filePath), 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const absolute = this.resolvePath(filePath);
    await ensureDir(path.dirname(absolute));
    await fs.promises.writeFile(absolute, content, 'utf-8');
  }

  async applyEdit(filePath: string, findString: string, replaceString: string): Promise<void> {
    const absolute = this.resolvePath(filePath);
    const content = await this.readFile(absolute);
    if (content.includes(findString)) {
      // A function replacement inserts the text literally; a string replacement would
      // interpret $$, $&, $` and $' inside it.
      const newContent = content.replace(findString, () => replaceString);
      await this.writeFile(absolute, newContent);
    } else {
      throw new Error(`Could not find string in file: ${filePath}`);
    }
  }

  async applyUnifiedPatch(filePath: string, patch: string): Promise<void> {
    if (!patch || typeof patch !== 'string') {
      throw new Error('apply_patch requires a unified diff string.');
    }

    const absolute = this.resolvePath(filePath);
    const current = await this.readFile(absolute);
    const next = applyPatch(current, patch);

    if (next === false) {
      throw new Error('Patch could not be applied cleanly.');
    }

    await this.writeFile(absolute, next);
  }

  private resolvePath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.join(this.baseDir, filePath);
  }
}
