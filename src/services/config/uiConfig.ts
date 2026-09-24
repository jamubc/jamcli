import fs from 'fs-extra';
import path from 'path';
import type {
  StatusIndicatorCustomDefinition,
  StatusIndicatorStyleId,
  StatusSpinnerStyleId,
  StatusTextStyleId,
  UiConfig,
} from '../../types/config.js';
import { DEFAULT_UI_CONFIG } from './defaults.js';

export interface UiPaths {
  uiConfigPath: string;
  statusStylesDir: string;
  globalDir: string;
}

export const initializeUiConfig = async ({ uiConfigPath, statusStylesDir, globalDir }: UiPaths): Promise<void> => {
  await fs.ensureDir(globalDir);
  await fs.ensureDir(statusStylesDir);
  if (!(await fs.pathExists(uiConfigPath))) {
    await fs.writeJson(uiConfigPath, DEFAULT_UI_CONFIG, { spaces: 2 });
  }
};

/** The interface's settings, or the defaults when none were saved. Reading writes nothing. */
export const readUiConfig = async (paths: UiPaths): Promise<UiConfig> => {
  if (!(await fs.pathExists(paths.uiConfigPath))) return { ...DEFAULT_UI_CONFIG };
  return { ...DEFAULT_UI_CONFIG, ...(await fs.readJson(paths.uiConfigPath)) };
};

export const writeUiConfig = async (paths: UiPaths, partial: Partial<UiConfig>): Promise<UiConfig> => {
  const current = await readUiConfig(paths);
  const updated: UiConfig = { ...DEFAULT_UI_CONFIG, ...current, ...partial };
  await initializeUiConfig(paths);
  await fs.writeJson(paths.uiConfigPath, updated, { spaces: 2 });
  return updated;
};

export const customStatusStylePath = (paths: UiPaths, name: string) => path.join(paths.statusStylesDir, `${name}.json`);

export const registerCustomStatusStyle = async (
  paths: UiPaths,
  name: string,
  definitionPath: string
): Promise<UiConfig> => {
  const current = await readUiConfig(paths);
  const custom = { ...(current.custom_status_styles || {}) };
  custom[name] = { path: definitionPath };
  return writeUiConfig(paths, { custom_status_styles: custom });
};

export const ensureCustomStatusStyle = async (
  paths: UiPaths,
  name: string,
  template: StatusIndicatorCustomDefinition
): Promise<{ path: string; uiConfig: UiConfig }> => {
  await initializeUiConfig(paths);
  const targetPath = customStatusStylePath(paths, name);
  if (!(await fs.pathExists(targetPath))) {
    await fs.writeJson(targetPath, template, { spaces: 2 });
  }
  const uiConfig = await registerCustomStatusStyle(paths, name, targetPath);
  return { path: targetPath, uiConfig };
};

export type { StatusIndicatorStyleId, StatusSpinnerStyleId, StatusTextStyleId };
