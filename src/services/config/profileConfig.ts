import fs from 'fs-extra';
import path from 'path';
import type { Profile } from '../../types/config.js';
import { DEFAULT_PROFILE } from './defaults.js';

export const readProfile = async (profilesDir: string, profileName: string): Promise<Profile> => {
  const profilePath = path.join(profilesDir, `${profileName}.json`);
  if (await fs.pathExists(profilePath)) {
    return fs.readJson(profilePath);
  }
  return DEFAULT_PROFILE;
};

export const writeProfile = async (profilePath: string, partial: Partial<Profile>): Promise<Profile> => {
  const profile: Profile = (await fs.pathExists(profilePath)) ? await fs.readJson(profilePath) : { ...DEFAULT_PROFILE };
  const updated: Profile = { ...profile, ...partial };
  await fs.ensureDir(path.dirname(profilePath));
  await fs.writeJson(profilePath, updated, { spaces: 2 });
  return updated;
};
