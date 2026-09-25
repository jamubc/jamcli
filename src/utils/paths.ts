import envPaths from 'env-paths';
import path from 'path';
import os from 'os';

const paths = envPaths('jamcli', { suffix: '' });

export interface JamCliPaths {
  config: string;
  state: string;
  cache: string;
  data: string;
  projectLocal: (projectRoot: string) => string;
}

export const jamcliPaths: JamCliPaths = {
  // Global config: ~/.config/jamcli (XDG_CONFIG_HOME)
  config: paths.config,
  
  // Global state: ~/.local/state/jamcli (XDG_STATE_HOME)
  state: paths.data.replace('/share/', '/state/'),
  
  // Global cache: ~/.cache/jamcli (XDG_CACHE_HOME)
  cache: paths.cache,
  
  // Global data: ~/.local/share/jamcli (XDG_DATA_HOME)
  data: paths.data,
  
  // Project-local: <project>/.jamcli
  projectLocal: (projectRoot: string) => path.join(projectRoot, '.jamcli'),
};

/** The user configuration directory, `~/.config/jamcli` on every platform. JAMCLI_CONFIG_DIR overrides it. */
export function userConfigDir(): string {
  if (process.env.JAMCLI_CONFIG_DIR) return process.env.JAMCLI_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'jamcli');
}

/** The data directory, for installed plugins, `~/.local/share/jamcli`. JAMCLI_DATA_DIR overrides it. */
export function userDataDir(): string {
  return process.env.JAMCLI_DATA_DIR || jamcliPaths.data;
}

/** The cache directory, for what JamCLI can fetch again, such as model metadata. JAMCLI_CACHE_DIR overrides it. */
export function userCacheDir(): string {
  return process.env.JAMCLI_CACHE_DIR || jamcliPaths.cache;
}

// Helper to get platform-specific state directory. JAMCLI_STATE_DIR overrides it.
export function getStateDir(): string {
  if (process.env.JAMCLI_STATE_DIR) {
    return process.env.JAMCLI_STATE_DIR;
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'jamcli');
  } else if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'jamcli');
  } else {
    // Linux/Unix - follow XDG spec
    return process.env.XDG_STATE_HOME 
      ? path.join(process.env.XDG_STATE_HOME, 'jamcli')
      : path.join(os.homedir(), '.local', 'state', 'jamcli');
  }
}
