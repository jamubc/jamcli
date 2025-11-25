import fs from 'fs-extra';
import path from 'path';
import {
  StatusIndicatorCustomDefinition,
  StatusIndicatorStyleId,
  StatusIndicatorStyleRef,
  StatusSpinnerStyleId,
  StatusTextStyleId,
  UiConfig,
} from '../types/config.js';

export type StatusTextStyleDefinition = {
  id: StatusTextStyleId;
  label: string;
  shimmerColors: string[];
  shimmer: boolean;
  source: 'builtin' | 'custom';
  path?: string;
};

export type StatusSpinnerStyleDefinition = {
  id: StatusSpinnerStyleId;
  label: string;
  spinnerFrames: string[];
  spinnerColors?: string[];
  intervalMs?: number;
  source: 'builtin' | 'custom';
  path?: string;
};

export type StatusStyleDefinition = {
  id: string;
  label: string;
  shimmerColors: string[];
  spinnerFrames: string[];
  shimmer: boolean;
  spinnerColors: string[];
  spinnerIntervalMs: number;
  source: 'builtin' | 'custom';
  textStyleId: StatusTextStyleId;
  spinnerStyleId: StatusSpinnerStyleId;
  path?: string;
};

const defaultSpinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const defaultSpinnerColors = ['cyan', 'magenta'];

export const BUILTIN_TEXT_STYLES: Record<string, StatusTextStyleDefinition> = {
  subtle: {
    id: 'subtle',
    label: 'Subtle (default)',
    shimmerColors: ['cyan', 'white', 'gray'],
    shimmer: true,
    source: 'builtin',
  },
  rainbow: {
    id: 'rainbow',
    label: 'Prism',
    shimmerColors: ['cyan', 'magenta', 'yellow', 'green', 'blue'],
    shimmer: true,
    source: 'builtin',
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    shimmerColors: ['gray'],
    shimmer: false,
    source: 'builtin',
  },
  aurora: {
    id: 'aurora',
    label: 'Aurora',
    shimmerColors: ['blue', 'cyan', 'magenta'],
    shimmer: true,
    source: 'builtin',
  },
  mono: {
    id: 'mono',
    label: 'Monochrome Glow',
    shimmerColors: ['white'],
    shimmer: true,
    source: 'builtin',
  },
};

export const BUILTIN_SPINNER_STYLES: Record<string, StatusSpinnerStyleDefinition> = {
  classic: {
    id: 'classic',
    label: 'Classic spinner',
    spinnerFrames: defaultSpinnerFrames,
    spinnerColors: ['cyan', 'white'],
    intervalMs: 80,
    source: 'builtin',
  },
  orbit: {
    id: 'orbit',
    label: 'Orbit',
    spinnerFrames: ['◐', '◓', '◑', '◒'],
    spinnerColors: ['cyan', 'blue'],
    intervalMs: 90,
    source: 'builtin',
  },
  pulse: {
    id: 'pulse',
    label: 'Pulse',
    spinnerFrames: ['∙', '•', '●', '•'],
    spinnerColors: ['yellow'],
    intervalMs: 120,
    source: 'builtin',
  },
  big_classic: {
    id: 'big_classic',
    label: 'Classic (Big)',
    spinnerFrames: [
      '  ┃  \n  ┃  \n  ┃  ',
      '    ╱\n   ╱ \n  ╱  ',
      '     \n━━━━━\n     ',
      '╲    \n ╲   \n  ╲  ',
    ],
    spinnerColors: ['cyan', 'white'],
    intervalMs: 80,
    source: 'builtin',
  },
  big_orbit: {
    id: 'big_orbit',
    label: 'Orbit (Big)',
    spinnerFrames: [
      '██   \n██   \n██   ',
      '▀▀▀▀▀\n     \n     ',
      '   ██\n   ██\n   ██',
      '     \n     \n▄▄▄▄▄',
    ],
    spinnerColors: ['cyan', 'blue'],
    intervalMs: 90,
    source: 'builtin',
  },
  big_pulse: {
    id: 'big_pulse',
    label: 'Pulse (Big)',
    spinnerFrames: [
      '     \n  ·  \n     ',
      '     \n  ●  \n     ',
      ' ▄▄▄ \n █ █ \n ▀▀▀ ',
      '     \n  ●  \n     ',
    ],
    spinnerColors: ['yellow'],
    intervalMs: 120,
    source: 'builtin',
  },
};

export const DEFAULT_CUSTOM_STYLE: StatusIndicatorCustomDefinition = {
  label: 'Custom style',
  shimmerColors: ['cyan', 'white'],
  spinnerFrames: defaultSpinnerFrames,
  shimmer: true,
};

export const buildStatusStyle = (
  textStyle: StatusTextStyleDefinition,
  spinnerStyle: StatusSpinnerStyleDefinition
): StatusStyleDefinition => {
  const spinnerColors =
    spinnerStyle.spinnerColors && spinnerStyle.spinnerColors.length > 0 ? spinnerStyle.spinnerColors : defaultSpinnerColors;
  return {
    id: `${textStyle.id}::${spinnerStyle.id}`,
    label: `${textStyle.label} x ${spinnerStyle.label}`,
    shimmerColors: textStyle.shimmerColors && textStyle.shimmerColors.length > 0 ? textStyle.shimmerColors : ['white'],
    spinnerFrames:
      spinnerStyle.spinnerFrames && spinnerStyle.spinnerFrames.length > 0 ? spinnerStyle.spinnerFrames : defaultSpinnerFrames,
    shimmer: textStyle.shimmer ?? true,
    spinnerColors,
    spinnerIntervalMs: spinnerStyle.intervalMs ?? 80,
    source: textStyle.source === 'custom' || spinnerStyle.source === 'custom' ? 'custom' : 'builtin',
    textStyleId: textStyle.id,
    spinnerStyleId: spinnerStyle.id,
    path: textStyle.path || spinnerStyle.path,
  };
};

export const DEFAULT_TEXT_STYLE_ID: StatusTextStyleId = 'subtle';
export const DEFAULT_SPINNER_STYLE_ID: StatusSpinnerStyleId = 'classic';
export const DEFAULT_STATUS_STYLE: StatusStyleDefinition = buildStatusStyle(
  BUILTIN_TEXT_STYLES[DEFAULT_TEXT_STYLE_ID],
  BUILTIN_SPINNER_STYLES[DEFAULT_SPINNER_STYLE_ID]
);

const readCustomDefinition = async (ref?: StatusIndicatorStyleRef): Promise<StatusIndicatorCustomDefinition | null> => {
  if (!ref?.path) return null;
  try {
    const exists = await fs.pathExists(ref.path);
    if (!exists) return null;
    const content = await fs.readJson(ref.path);
    return content as StatusIndicatorCustomDefinition;
  } catch {
    return null;
  }
};

export const resolveTextStyle = async (
  styleId: StatusTextStyleId | undefined,
  uiConfig?: UiConfig | null
): Promise<StatusTextStyleDefinition> => {
  const fallback = BUILTIN_TEXT_STYLES[DEFAULT_TEXT_STYLE_ID];
  if (!styleId) return fallback;

  if (BUILTIN_TEXT_STYLES[styleId]) {
    return BUILTIN_TEXT_STYLES[styleId];
  }

  if (!uiConfig || !styleId.startsWith('custom:')) return fallback;
  const name = styleId.replace(/^custom:/, '');
  const ref = uiConfig.custom_status_styles?.[name];
  const customDef = await readCustomDefinition(ref);
  if (!customDef) return fallback;
  const shimmerColors = customDef.shimmerColors && customDef.shimmerColors.length > 0 ? customDef.shimmerColors : ['white'];
  const shimmer = customDef.shimmer ?? true;
  const label = ref?.label || customDef.label || `Custom text: ${name}`;
  return {
    id: styleId,
    label,
    shimmerColors,
    shimmer,
    source: 'custom',
    path: ref?.path,
  };
};

export const resolveSpinnerStyle = async (
  styleId: StatusSpinnerStyleId | undefined,
  uiConfig?: UiConfig | null
): Promise<StatusSpinnerStyleDefinition> => {
  const fallback = BUILTIN_SPINNER_STYLES[DEFAULT_SPINNER_STYLE_ID];
  if (!styleId) return fallback;

  if (BUILTIN_SPINNER_STYLES[styleId]) {
    return BUILTIN_SPINNER_STYLES[styleId];
  }

  if (!uiConfig || !styleId.startsWith('custom:')) return fallback;
  const name = styleId.replace(/^custom:/, '');
  const ref = uiConfig.custom_status_styles?.[name];
  const customDef = await readCustomDefinition(ref);
  if (!customDef) return fallback;
  const spinnerFrames =
    customDef.spinnerFrames && customDef.spinnerFrames.length > 0 ? customDef.spinnerFrames : defaultSpinnerFrames;
  const spinnerColors =
    customDef.spinnerColors && customDef.spinnerColors.length > 0 ? customDef.spinnerColors : defaultSpinnerColors;
  const label = ref?.label || customDef.label || `Custom spinner: ${name}`;
  return {
    id: styleId,
    label,
    spinnerFrames,
    spinnerColors,
    intervalMs: customDef.spinnerIntervalMs ?? 80,
    source: 'custom',
    path: ref?.path,
  };
};

export const resolveStatusStyle = async ({
  uiConfig,
  textStyleId,
  spinnerStyleId,
}: {
  uiConfig?: UiConfig | null;
  textStyleId?: StatusTextStyleId;
  spinnerStyleId?: StatusSpinnerStyleId;
}): Promise<StatusStyleDefinition> => {
  const textId =
    textStyleId || uiConfig?.status_text_style || (uiConfig?.status_indicator_style as StatusTextStyleId | undefined) || DEFAULT_TEXT_STYLE_ID;
  const spinnerId =
    spinnerStyleId ||
    uiConfig?.status_spinner_style ||
    (uiConfig?.status_indicator_style as StatusSpinnerStyleId | undefined) ||
    DEFAULT_SPINNER_STYLE_ID;

  const textStyle = await resolveTextStyle(textId, uiConfig);
  const spinnerStyle = await resolveSpinnerStyle(spinnerId, uiConfig);
  return buildStatusStyle(textStyle, spinnerStyle);
};

export const listStatusTextStyleOptions = async (
  uiConfig: UiConfig | null
): Promise<Array<{ id: StatusTextStyleId; label: string; source: 'builtin' | 'custom'; path?: string }>> => {
  const options: Array<{ id: StatusTextStyleId; label: string; source: 'builtin' | 'custom'; path?: string }> = [
    { id: 'subtle', label: BUILTIN_TEXT_STYLES.subtle.label, source: 'builtin' },
    { id: 'rainbow', label: BUILTIN_TEXT_STYLES.rainbow.label, source: 'builtin' },
    { id: 'minimal', label: BUILTIN_TEXT_STYLES.minimal.label, source: 'builtin' },
    { id: 'aurora', label: BUILTIN_TEXT_STYLES.aurora.label, source: 'builtin' },
    { id: 'mono', label: BUILTIN_TEXT_STYLES.mono.label, source: 'builtin' },
  ];

  const customEntries = uiConfig?.custom_status_styles ? Object.entries(uiConfig.custom_status_styles) : [];
  for (const [name, ref] of customEntries) {
    options.push({
      id: `custom:${name}`,
      label: ref.label || `Custom text: ${name}`,
      source: 'custom',
      path: ref.path,
    });
  }

  return options;
};

export const listStatusSpinnerStyleOptions = async (
  uiConfig: UiConfig | null
): Promise<Array<{ id: StatusSpinnerStyleId; label: string; source: 'builtin' | 'custom'; path?: string }>> => {
  const options: Array<{ id: StatusSpinnerStyleId; label: string; source: 'builtin' | 'custom'; path?: string }> = [
    { id: 'classic', label: BUILTIN_SPINNER_STYLES.classic.label, source: 'builtin' },
    { id: 'orbit', label: BUILTIN_SPINNER_STYLES.orbit.label, source: 'builtin' },
    { id: 'pulse', label: BUILTIN_SPINNER_STYLES.pulse.label, source: 'builtin' },
    { id: 'big_classic', label: BUILTIN_SPINNER_STYLES.big_classic.label, source: 'builtin' },
    { id: 'big_orbit', label: BUILTIN_SPINNER_STYLES.big_orbit.label, source: 'builtin' },
    { id: 'big_pulse', label: BUILTIN_SPINNER_STYLES.big_pulse.label, source: 'builtin' },
  ];

  const customEntries = uiConfig?.custom_status_styles ? Object.entries(uiConfig.custom_status_styles) : [];
  for (const [name, ref] of customEntries) {
    options.push({
      id: `custom:${name}`,
      label: ref.label || `Custom spinner: ${name}`,
      source: 'custom',
      path: ref.path,
    });
  }

  return options;
};
