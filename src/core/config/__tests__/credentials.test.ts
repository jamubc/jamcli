import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectStore, fileStore, forgetStoredKeys, macKeychain, revealedKeys, secretService, storedKey } from '../credentials.js';
import { resolveApiKey } from '../../providers/factory.js';

let base: string;
const saved = { PATH: process.env.PATH, JAMCLI_CONFIG_DIR: process.env.JAMCLI_CONFIG_DIR, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-credentials-')));
  process.env.JAMCLI_CONFIG_DIR = path.join(base, 'config');
  delete process.env.OPENROUTER_API_KEY;
  forgetStoredKeys();
});
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  forgetStoredKeys();
  fs.rmSync(base, { recursive: true, force: true });
});

/**
 * Fake `security` and `secret-tool` executables that keep keys in a directory and log
 * their arguments, so the adapters run through a real process, as they do on a desktop.
 */
function fakeTools(): { log: () => string } {
  const bin = path.join(base, 'bin');
  const vault = path.join(base, 'vault');
  fs.mkdirSync(bin);
  fs.mkdirSync(vault);
  const logFile = path.join(base, 'argv.log');
  fs.writeFileSync(
    path.join(bin, 'security'),
    `#!/bin/bash
echo "security $*" >> "${logFile}"
if [ "$1" = "-i" ]; then
  read -r line
  account=$(echo "$line" | sed -E 's/.* -a "([^"]*)".*/\\1/')
  secret=$(echo "$line" | sed -E 's/.* -w "([^"]*)".*/\\1/')
  printf '%s' "$secret" > "${vault}/$account"; exit 0
fi
command="$1"; account=""
while [ $# -gt 0 ]; do [ "$1" = "-a" ] && account="$2"; shift; done
case "$command" in
  find-generic-password) [ -f "${vault}/$account" ] || exit 44; cat "${vault}/$account"; echo ;;
  delete-generic-password) [ -f "${vault}/$account" ] || exit 44; rm "${vault}/$account" ;;
esac
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(bin, 'secret-tool'),
    `#!/bin/bash
echo "secret-tool $*" >> "${logFile}"
action="$1"; account="\${@: -1}"
case "$action" in
  store) cat > "${vault}/$account" ;;
  lookup) [ -f "${vault}/$account" ] || exit 1; cat "${vault}/$account" ;;
  clear) rm -f "${vault}/$account" ;;
esac
`,
    { mode: 0o755 }
  );
  process.env.PATH = `${bin}${path.delimiter}${saved.PATH}`;
  return { log: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '') };
}

test('the file store keeps keys where only its owner can read them', () => {
  const store = fileStore(path.join(base, 'config'));
  expect(store.get('openrouter')).toBeUndefined();
  store.set('openrouter', 'sk-or-v1-file-key');
  store.set('anthropic', 'sk-ant-file-key');
  expect(store.get('openrouter')).toBe('sk-or-v1-file-key');
  const file = path.join(base, 'config', 'credentials.json');
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  expect(fs.statSync(path.join(base, 'config')).mode & 0o777).toBe(0o700);
  expect(store.remove('openrouter')).toBe(true);
  expect(store.remove('openrouter')).toBe(false);
  expect(fileStore(path.join(base, 'config')).get('anthropic')).toBe('sk-ant-file-key');
});

test('the macOS keychain gets each key on standard input, never as an argument', () => {
  const tools = fakeTools();
  const store = macKeychain();
  expect(store.get('openrouter')).toBeUndefined();
  store.set('openrouter', 'sk-or-v1-keychain-key');
  expect(store.get('openrouter')).toBe('sk-or-v1-keychain-key');
  expect(store.remove('openrouter')).toBe(true);
  expect(store.remove('openrouter')).toBe(false);
  expect(tools.log()).toContain('security find-generic-password -s jamcli -a openrouter -w');
  expect(tools.log()).not.toContain('keychain-key');
  expect(() => store.set('openrouter', 'has space')).toThrow('cannot be stored in the keychain');
});

test('the Secret Service gets each key on standard input, and a missing one is not an error', () => {
  const tools = fakeTools();
  const store = secretService();
  expect(store.get('anthropic')).toBeUndefined();
  store.set('anthropic', 'sk-ant-secret-service-key');
  expect(store.get('anthropic')).toBe('sk-ant-secret-service-key');
  expect(store.remove('anthropic')).toBe(true);
  expect(store.remove('anthropic')).toBe(false);
  expect(tools.log()).toContain('secret-tool store --label JamCLI key for anthropic service jamcli account anthropic');
  expect(tools.log()).not.toContain('service-key');
  // A keyring that cannot be reached is reported, not taken for an empty one.
  const broken = secretService(() => ({ status: 1, stdout: '', stderr: 'Cannot autolaunch D-Bus without X11 $DISPLAY' }));
  expect(() => broken.get('anthropic')).toThrow('Cannot autolaunch D-Bus');
});

test('the store is the keychain on macOS, the Secret Service where it runs, and the file otherwise', () => {
  fakeTools();
  const env = { PATH: process.env.PATH };
  expect(detectStore(env, 'darwin').kind).toBe('keychain');
  expect(detectStore({ ...env, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus' }, 'linux').kind).toBe('secret-service');
  expect(detectStore(env, 'linux').kind).toBe('file');
  expect(detectStore({ PATH: '/nowhere' }, 'darwin').kind).toBe('file');
  expect(detectStore({ ...env, JAMCLI_CREDENTIAL_STORE: 'file' }, 'darwin').kind).toBe('file');
  expect(() => detectStore({ JAMCLI_CREDENTIAL_STORE: 'vault' })).toThrow('JAMCLI_CREDENTIAL_STORE is keychain, secret-service, or file, not vault.');
});

test('a stored key is used last, after the declared variable, the configuration, and the usual variable', () => {
  fileStore().set('openrouter', 'sk-or-v1-stored');
  expect(resolveApiKey(undefined, 'OPENROUTER_API_KEY', 'openrouter')).toBe('sk-or-v1-stored');
  process.env.OPENROUTER_API_KEY = 'sk-or-v1-from-env';
  expect(resolveApiKey(undefined, 'OPENROUTER_API_KEY', 'openrouter')).toBe('sk-or-v1-from-env');
  expect(resolveApiKey({ api_key: 'sk-or-v1-config' }, 'OPENROUTER_API_KEY', 'openrouter')).toBe('sk-or-v1-config');
  process.env.MY_ROUTER_KEY = 'sk-or-v1-declared';
  expect(resolveApiKey({ api_key: 'sk-or-v1-config', key_env_var: 'MY_ROUTER_KEY' }, 'OPENROUTER_API_KEY', 'openrouter')).toBe('sk-or-v1-declared');
  delete process.env.MY_ROUTER_KEY;
  // Once used, the stored key is known to redaction.
  expect(revealedKeys()).toContainEqual({ name: 'stored:openrouter', value: 'sk-or-v1-stored' });
  expect(storedKey('nobody')).toBeUndefined();
});
