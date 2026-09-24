import fs from 'fs';
import { ensureDir, pathExists, readJson, writeJson } from '../../utils/fsx.js';
import path from 'path';
import type { Profile } from '../../types/config.js';
import { DEFAULT_PROFILE } from './defaults.js';

export const readProfile = async (profilesDir: string, profileName: string): Promise<Profile> => {
  const profilePath = path.join(profilesDir, `${profileName}.json`);
  if (await pathExists(profilePath)) {
    return readJson(profilePath);
  }
  return DEFAULT_PROFILE;
};

export const writeProfile = async (profilePath: string, partial: Partial<Profile>): Promise<Profile> => {
  const profile: Profile = (await pathExists(profilePath)) ? await readJson(profilePath) : { ...DEFAULT_PROFILE };
  const updated: Profile = { ...profile, ...partial };
  await ensureDir(path.dirname(profilePath));
  await writeJson(profilePath, updated, { spaces: 2 });
  return updated;
};
