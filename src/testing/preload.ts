import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Every test run gets its own user configuration, state, and cache directories, so
 * settings in the developer's own ~/.config/jamcli, session index, or cached model
 * metadata can never change a result.
 */
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-test-home-'));
process.env.JAMCLI_CONFIG_DIR = path.join(base, 'config');
process.env.JAMCLI_STATE_DIR = path.join(base, 'state');
process.env.JAMCLI_CACHE_DIR = path.join(base, 'cache');
process.on('exit', () => fs.rmSync(base, { recursive: true, force: true }));
