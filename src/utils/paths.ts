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

// Helper to get platform-specific state directory
export function getStateDir(): string {
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
