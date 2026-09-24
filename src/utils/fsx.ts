import fs from 'fs';

/**
 * The few conveniences JamCLI used from fs-extra, over Node's own fs. fs-extra cost about
 * 30 ms to load on every start; these cost nothing. JSON is written as fs-extra wrote it,
 * with a newline at the end, and read with a byte-order mark ignored.
 */

export const pathExists = (file: string): Promise<boolean> =>
  fs.promises.access(file).then(
    () => true,
    () => false
  );

const parse = (text: string) => JSON.parse(text.replace(/^\uFEFF/, ''));

export const readJson = async (file: string): Promise<any> => parse(await fs.promises.readFile(file, 'utf8'));

export const readJsonSync = (file: string): any => parse(fs.readFileSync(file, 'utf8'));

export const writeJson = (file: string, value: unknown, options: { spaces?: number } = {}): Promise<void> =>
  fs.promises.writeFile(file, `${JSON.stringify(value, null, options.spaces)}\n`, 'utf8');

export const ensureDir = async (dir: string): Promise<void> => {
  await fs.promises.mkdir(dir, { recursive: true });
};

export const ensureDirSync = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

/** Write JSON, creating the directories on the way. */
export const outputJson = async (file: string, value: unknown, options: { spaces?: number } = {}): Promise<void> => {
  await ensureDir((await import('path')).dirname(file));
  await writeJson(file, value, options);
};

export const remove = (target: string): Promise<void> => fs.promises.rm(target, { recursive: true, force: true });
