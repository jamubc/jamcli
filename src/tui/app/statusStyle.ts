import fs from 'fs';
import os from 'os';
import path from 'path';
import type { UiConfig, UiSettings } from '../../types/config.js';
import { userConfigDir } from '../../utils/paths.js';
import { resolveStatusStyle, type StatusStyleDefinition } from '../../styles/statusStyles.js';

/** Where the Ink interface kept its settings. It is read, never written, so a style chosen there carries over. */
export const legacyUiFile = (home: string = os.homedir()): string => path.join(home, '.jamubc', 'ui.json');

/** The Ink interface's settings, or nothing when there are none or they cannot be read. */
export function legacyUi(file: string = legacyUiFile()): Partial<UiConfig> {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * The style settings in force: the ui block's, then those saved by the Ink interface. A
 * custom style's file is found from the user configuration directory when its path is
 * relative.
 */
export function mergedUi(ui: UiSettings, legacy: Partial<UiConfig> = legacyUi()): UiConfig {
  const custom = { ...(legacy.custom_status_styles ?? {}) };
  for (const [name, ref] of Object.entries(ui.custom_status_styles ?? {})) {
    custom[name] = { ...ref, path: path.isAbsolute(ref.path) ? ref.path : path.join(userConfigDir(), ref.path) };
  }
  return {
    status_indicator_style: legacy.status_indicator_style ?? 'subtle',
    ...((ui.status_text_style ?? legacy.status_text_style) ? { status_text_style: ui.status_text_style ?? legacy.status_text_style } : {}),
    ...((ui.status_spinner_style ?? legacy.status_spinner_style) ? { status_spinner_style: ui.status_spinner_style ?? legacy.status_spinner_style } : {}),
    custom_status_styles: custom,
  };
}

/** The working indicator's style. A custom style that cannot be read falls back to the default. */
export const statusStyleFor = (ui: UiSettings, legacy?: Partial<UiConfig>): Promise<StatusStyleDefinition> =>
  resolveStatusStyle({ uiConfig: mergedUi(ui, legacy) });

/** One row of a spinner frame: the middle row of a tall one, so the status line stays one line high. */
export function frameRow(frame: string): string {
  if (!frame.includes('\n')) return frame;
  const rows = frame.split('\n');
  return rows[Math.floor(rows.length / 2)].trim() || rows.find((row) => row.trim())?.trim() || '';
}
