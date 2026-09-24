import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { userConfigDir } from '../../utils/paths.js';

/** Where stored keys live: the macOS keychain, the Secret Service on Linux, or a file only its owner can read. */
export type StoreKind = 'keychain' | 'secret-service' | 'file';

export interface CredentialStore {
  readonly kind: StoreKind;
  /** Where keys are kept, in words, for messages. */
  readonly where: string;
  get(account: string): string | undefined;
  set(account: string, secret: string): void;
  /** False when there was nothing to remove. */
  remove(account: string): boolean;
}

/** The service name every stored key is filed under. */
export const SERVICE = 'jamcli';

type Run = (command: string, args: string[], input?: string) => { status: number | null; stdout: string; stderr: string; error?: Error };

const defaultRun: Run = (command, args, input) => {
  const result = spawnSync(command, args, { input, encoding: 'utf8', timeout: 10_000 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
};

const failure = (what: string, result: ReturnType<Run>): Error =>
  new Error(`${what} failed: ${(result.error?.message ?? result.stderr.trim()) || `exit ${result.status}`}`);

/**
 * The macOS keychain, through `security`. A key is written through `security -i` on
 * standard input, so it never appears in a process list.
 */
export function macKeychain(run: Run = defaultRun): CredentialStore {
  return {
    kind: 'keychain',
    where: 'the macOS keychain',
    get(account) {
      const result = run('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']);
      if (result.status === 0) return result.stdout.replace(/\n$/, '') || undefined;
      // 44 is the keychain's "not found".
      if (result.status === 44) return undefined;
      throw failure('Reading the keychain', result);
    },
    set(account, secret) {
      if (/["\\\s]/.test(secret) || /["\\\s]/.test(account)) throw new Error('A key with spaces, quotes, or backslashes cannot be stored in the keychain.');
      const result = run('security', ['-i'], `add-generic-password -U -s ${SERVICE} -a "${account}" -w "${secret}"\n`);
      if (result.status !== 0 || /error/i.test(result.stderr)) throw failure('Writing to the keychain', result);
    },
    remove(account) {
      const result = run('security', ['delete-generic-password', '-s', SERVICE, '-a', account]);
      if (result.status === 0) return true;
      if (result.status === 44) return false;
      throw failure('Removing from the keychain', result);
    },
  };
}

/** The Secret Service on Linux, through `secret-tool`. A key is written on standard input. */
export function secretService(run: Run = defaultRun): CredentialStore {
  const attributes = (account: string) => ['service', SERVICE, 'account', account];
  const lookup = (account: string) => {
    const result = run('secret-tool', ['lookup', ...attributes(account)]);
    if (result.status === 0) return result.stdout.replace(/\n$/, '') || undefined;
    // secret-tool exits 1 with nothing on stderr when there is no such key.
    if (result.status === 1 && !result.stderr.trim()) return undefined;
    throw failure('Reading the Secret Service', result);
  };
  return {
    kind: 'secret-service',
    where: 'the Secret Service keyring',
    get: lookup,
    set(account, secret) {
      const result = run('secret-tool', ['store', '--label', `JamCLI key for ${account}`, ...attributes(account)], secret);
      if (result.status !== 0) throw failure('Writing to the Secret Service', result);
    },
    remove(account) {
      if (lookup(account) === undefined) return false;
      const result = run('secret-tool', ['clear', ...attributes(account)]);
      if (result.status !== 0) throw failure('Removing from the Secret Service', result);
      return true;
    },
  };
}

interface KeyFile {
  version: 1;
  keys: Record<string, string>;
}

/**
 * A file in the user configuration directory, readable and writable only by its owner,
 * for machines with no keychain. It is written whole, to a temporary file first.
 */
export function fileStore(dir: string = userConfigDir()): CredentialStore {
  const file = path.join(dir, 'credentials.json');
  const read = (): KeyFile => {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { version: 1, keys: {} };
      throw error;
    }
    const parsed = JSON.parse(text);
    return { version: 1, keys: parsed && typeof parsed.keys === 'object' && parsed.keys ? parsed.keys : {} };
  };
  const write = (data: KeyFile) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file);
  };
  return {
    kind: 'file',
    where: file,
    get: (account) => read().keys[account] || undefined,
    set(account, secret) {
      const data = read();
      data.keys[account] = secret;
      write(data);
    },
    remove(account) {
      const data = read();
      if (!(account in data.keys)) return false;
      delete data.keys[account];
      write(data);
      return true;
    },
  };
}

const onPath = (command: string, env: Record<string, string | undefined>): boolean =>
  (env.PATH ?? '').split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, command)));

/**
 * The store this machine offers: the keychain on macOS, the Secret Service where
 * `secret-tool` and a session bus exist, and the file otherwise.
 * `JAMCLI_CREDENTIAL_STORE` chooses one by name.
 */
export function detectStore(env: Record<string, string | undefined> = process.env, platform: string = process.platform): CredentialStore {
  const chosen = env.JAMCLI_CREDENTIAL_STORE?.trim();
  if (chosen === 'keychain') return macKeychain();
  if (chosen === 'secret-service') return secretService();
  if (chosen === 'file') return fileStore();
  if (chosen) throw new Error(`JAMCLI_CREDENTIAL_STORE is keychain, secret-service, or file, not ${chosen}.`);
  if (platform === 'darwin' && onPath('security', env)) return macKeychain();
  if (platform === 'linux' && onPath('secret-tool', env) && env.DBUS_SESSION_BUS_ADDRESS) return secretService();
  return fileStore();
}

/** Keys the store has handed out in this process, so every surface can redact them. */
const revealed = new Map<string, string>();
/** Keys found, so a keychain is asked once per process for each. A key not found is asked for again, since one may be stored meanwhile. */
const looked = new Map<string, string>();

/**
 * The stored key for a provider, or nothing. A store that cannot be read counts as
 * holding nothing here; `jamcli auth` and `jamcli doctor` report why.
 */
export function storedKey(account: string): string | undefined {
  const known = looked.get(account);
  if (known) return known;
  let value: string | undefined;
  try {
    value = detectStore().get(account);
  } catch {
    value = undefined;
  }
  if (value) {
    looked.set(account, value);
    revealed.set(account, value);
  }
  return value;
}

/** Forget what was looked up, after a key is stored or removed. */
export function forgetStoredKeys(): void {
  looked.clear();
}

/** Every stored key used in this process, named for redaction. */
export const revealedKeys = (): { name: string; value: string }[] =>
  [...revealed].map(([account, value]) => ({ name: `stored:${account}`, value }));
