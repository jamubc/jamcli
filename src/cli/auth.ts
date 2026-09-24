import { spawn } from 'child_process';
import { loadConfig } from '../core/config/load.js';
import { detectStore, forgetStoredKeys, type CredentialStore } from '../core/config/credentials.js';
import { openRouterLogin } from '../core/config/pkce.js';
import { keySource } from '../core/providers/factory.js';

export type AuthAction = 'set' | 'get' | 'remove' | 'list' | 'login';
export const AUTH_ACTIONS: readonly AuthAction[] = ['set', 'get', 'remove', 'list', 'login'];

export interface AuthCommandRequest {
  action: AuthAction;
  args: string[];
}

export interface AuthCommandIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Read a key without echoing it, or from standard input when it is not a terminal. */
  readKey: (prompt: string) => Promise<string>;
  /** Show the person a page: open their browser. The address is always printed as well. */
  openUrl: (url: string) => void;
  store?: () => CredentialStore;
  /** Where the OpenRouter sign-in pages are, for tests. */
  openRouter?: { authUrl?: string; keysUrl?: string; timeoutMs?: number };
}

export const AUTH_USAGE = `Usage:
  jamcli auth set <provider>                 Store a key, typed or piped in, never passed as an argument
  jamcli auth get <provider> [--reveal]      Where the provider's key comes from; --reveal prints a stored key
  jamcli auth remove <provider>              Remove a stored key
  jamcli auth list                           Where each configured provider's key comes from
  jamcli auth login openrouter [--no-browser]  Sign in to OpenRouter in the browser and store the key it issues

A provider is openrouter, openai, anthropic, or the id of an entry in api_registry.endpoints.
Keys are stored in the macOS keychain, the Secret Service on Linux, or, where neither exists,
a file in ~/.config/jamcli readable only by you. JAMCLI_CREDENTIAL_STORE=keychain|secret-service|file chooses.`;

const BUILT_IN = ['openrouter', 'openai', 'anthropic'];

/** Read a line from the terminal without echoing it; with a pipe, read all of standard input. */
export async function readKeyFromStdin(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let text = '';
    for await (const chunk of stdin) text += chunk;
    return text.trim();
  }
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stderr.write('\n');
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return done();
        if (char === '\u0003') return done(new Error('Cancelled.'));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

/** Open a page in the person's browser, quietly; the address is printed anyway. */
export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  } catch {
    // The printed address is enough.
  }
}

const defaultIo: AuthCommandIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  readKey: readKeyFromStdin,
  openUrl: openInBrowser,
};

/** A key shown as its first and last few characters, which is enough to tell two apart. */
export const maskKey = (key: string): string => (key.length <= 12 ? '(hidden)' : `${key.slice(0, 6)}...${key.slice(-4)}`);

export async function runAuthCommand(request: AuthCommandRequest, projectRoot: string, io: AuthCommandIo = defaultIo): Promise<number> {
  const flags = new Set(request.args.filter((arg) => arg.startsWith('--')));
  const [provider] = request.args.filter((arg) => !arg.startsWith('--'));
  const unknown = [...flags].filter((flag) => !['--reveal', '--no-browser'].includes(flag));
  if (unknown.length) {
    io.err(`Unknown option: ${unknown.join(', ')}\n\n${AUTH_USAGE}`);
    return 2;
  }
  const registry = loadConfig({ projectRoot }).config.api_registry;
  const endpoints = (registry.endpoints ?? []).map((endpoint) => endpoint.id);
  let store: CredentialStore;
  try {
    store = (io.store ?? detectStore)();
  } catch (error: any) {
    io.err(error?.message ?? String(error));
    return 1;
  }
  const where = store.kind === 'file' ? `${store.where}, readable only by you` : store.where;

  if (request.action === 'list') {
    for (const name of [...BUILT_IN, ...endpoints]) io.out(`${name}\t${keySource(name, registry).detail}`);
    io.out(`Stored keys are kept in ${where}.`);
    return 0;
  }

  if (!provider) {
    io.err(AUTH_USAGE);
    return 2;
  }
  if (!/^[\w.-]+$/.test(provider)) {
    io.err(`${provider} is not a provider name.`);
    return 2;
  }
  if (!BUILT_IN.includes(provider) && !endpoints.includes(provider)) {
    io.err(`Note: ${provider} is not a built-in provider or an entry in api_registry.endpoints, so nothing uses this key yet.`);
  }

  /** The source that wins over a stored key, when there is one. */
  const shadow = () => {
    forgetStoredKeys();
    const source = keySource(provider, registry);
    return source.from === 'env' || source.from === 'config' ? source.detail : undefined;
  };

  try {
    if (request.action === 'set' || request.action === 'login') {
      let key: string;
      if (request.action === 'login') {
        if (provider !== 'openrouter') {
          io.err(`Signing in works for openrouter only. For ${provider}, run jamcli auth set ${provider}.`);
          return 2;
        }
        key = await openRouterLogin({
          ...io.openRouter,
          open: (url) => {
            io.err(`Sign in to OpenRouter at:\n  ${url}`);
            if (!flags.has('--no-browser')) io.openUrl(url);
          },
        });
      } else {
        key = await io.readKey(`Key for ${provider}: `);
        if (!key) {
          io.err('No key was given, so nothing was stored.');
          return 1;
        }
        if (/\s/.test(key)) {
          io.err('A key has no spaces in it, so nothing was stored.');
          return 1;
        }
      }
      store.set(provider, key);
      io.out(`Stored the key for ${provider} (${maskKey(key)}) in ${where}.`);
      const winner = shadow();
      if (winner) io.err(`${winner[0].toUpperCase()}${winner.slice(1)} also holds a key for ${provider}, and is used first.`);
      return 0;
    }

    if (request.action === 'remove') {
      const removed = store.remove(provider);
      forgetStoredKeys();
      if (!removed) {
        io.err(`No key is stored for ${provider} in ${where}.`);
        return 1;
      }
      io.out(`Removed the key for ${provider} from ${where}.`);
      return 0;
    }

    // get
    const stored = store.get(provider);
    if (flags.has('--reveal')) {
      if (!stored) {
        io.err(`No key is stored for ${provider} in ${where}.`);
        return 1;
      }
      io.out(stored);
      return 0;
    }
    io.out(stored ? `A key for ${provider} (${maskKey(stored)}) is stored in ${where}.` : `No key is stored for ${provider} in ${where}.`);
    const source = keySource(provider, registry);
    io.out(source.from === 'none' ? `${provider} has no key.` : `${provider} uses the key from ${source.detail}.`);
    return 0;
  } catch (error: any) {
    io.err(error?.message ?? String(error));
    if (store.kind !== 'file') io.err('To keep keys in a file readable only by you instead, set JAMCLI_CREDENTIAL_STORE=file.');
    return 1;
  }
}
