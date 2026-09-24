import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Every test run gets its own user configuration, state, and cache directories, so
 * settings in the developer's own ~/.config/jamcli, session index, cached model
 * metadata, or stored keys can never change a result.
 */
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-test-home-'));
process.env.JAMCLI_CONFIG_DIR = path.join(base, 'config');
process.env.JAMCLI_STATE_DIR = path.join(base, 'state');
process.env.JAMCLI_CACHE_DIR = path.join(base, 'cache');
// Keys a test stores go to a file in that directory, never to the developer's keychain.
process.env.JAMCLI_CREDENTIAL_STORE = 'file';
process.on('exit', () => fs.rmSync(base, { recursive: true, force: true }));
