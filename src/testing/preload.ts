import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Every test run gets its own user configuration and state directories, so settings in
 * the developer's own ~/.config/jamcli or session index can never change a result.
 */
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-test-home-'));
process.env.JAMCLI_CONFIG_DIR = path.join(base, 'config');
process.env.JAMCLI_STATE_DIR = path.join(base, 'state');
process.on('exit', () => fs.rmSync(base, { recursive: true, force: true }));
