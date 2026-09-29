import { pathExists, readJson } from '../utils/fsx.js';
import {
  StatusIndicatorCustomDefinition,
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

const defaultSpinnerFrames = ['∙', '∙', '•', '●', '●', '●', '•', '∙'];
const defaultSpinnerColors = ['dim', 'accent'];

/**
 * Colors in a style are hex colors, or a theme role (`text`, `dim`, `accent`, `warn`,
 * `error`) so a style follows the theme. The words' colors are a ramp from resting to lit:
 * the first is the words at rest and the last the center of the band of light that sweeps
 * across them. The spinner's colors are the ramp it breathes through over one cycle.
 */
export const BUILTIN_TEXT_STYLES: Record<string, StatusTextStyleDefinition> = {
  glow: {
    id: 'glow',
    label: 'Glow (default)',
    shimmerColors: ['dim', 'accent'],
    shimmer: true,
    source: 'builtin',
  },
  mono: {
    id: 'mono',
    label: 'Mono',
    shimmerColors: ['dim', 'text'],
    shimmer: true,
    source: 'builtin',
  },
  aurora: {
    id: 'aurora',
    label: 'Aurora',
    shimmerColors: ['dim', '#7aa2f7', '#bb9af7'],
    shimmer: true,
    source: 'builtin',
  },
  rainbow: {
    id: 'rainbow',
    label: 'Prism',
    shimmerColors: ['dim', '#f7768e', '#e0af68', '#9ece6a', '#7dcfff', '#bb9af7'],
    shimmer: true,
    source: 'builtin',
  },
  minimal: {
    id: 'minimal',
    label: 'Still',
    shimmerColors: ['dim'],
    shimmer: false,
    source: 'builtin',
  },
};

export const BUILTIN_SPINNER_STYLES: Record<string, StatusSpinnerStyleDefinition> = {
  pulse: {
    id: 'pulse',
    label: 'Pulse (default)',
    spinnerFrames: defaultSpinnerFrames,
    spinnerColors: defaultSpinnerColors,
    intervalMs: 110,
    source: 'builtin',
  },
  bloom: {
    id: 'bloom',
    label: 'Bloom',
    spinnerFrames: ['·', '✢', '✳', '✶', '✷', '✸', '✷', '✶', '✳', '✢'],
    spinnerColors: ['dim', 'accent'],
    intervalMs: 90,
    source: 'builtin',
  },
  orbit: {
    id: 'orbit',
    label: 'Orbit',
    spinnerFrames: ['◜', '◠', '◝', '◞', '◡', '◟'],
    spinnerColors: ['accent'],
    intervalMs: 100,
    source: 'builtin',
  },
  quad: {
    id: 'quad',
    label: 'Quad',
    spinnerFrames: ['▖', '▘', '▝', '▗'],
    spinnerColors: ['accent'],
    intervalMs: 130,
    source: 'builtin',
  },
  classic: {
    id: 'classic',
    label: 'Braille',
    spinnerFrames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    spinnerColors: ['dim', 'accent'],
    intervalMs: 80,
    source: 'builtin',
  },
};

/** Ids the Ink interface's styles were saved under, and the style each means now. */
export const LEGACY_STYLE_IDS: Record<string, string> = {
  subtle: 'glow',
  big_classic: 'classic',
  big_orbit: 'orbit',
  big_pulse: 'pulse',
};

/** A style id with a legacy name mapped to the style it means now. */
export const canonicalStyleId = <T extends string>(id: T): T => (LEGACY_STYLE_IDS[id] ?? id) as T;

export const DEFAULT_CUSTOM_STYLE: StatusIndicatorCustomDefinition = {
  label: 'Custom style',
  shimmerColors: ['dim', 'accent'],
  spinnerFrames: defaultSpinnerFrames,
  spinnerColors: defaultSpinnerColors,
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

export const DEFAULT_TEXT_STYLE_ID: StatusTextStyleId = 'glow';
export const DEFAULT_SPINNER_STYLE_ID: StatusSpinnerStyleId = 'pulse';
export const DEFAULT_STATUS_STYLE: StatusStyleDefinition = buildStatusStyle(
  BUILTIN_TEXT_STYLES[DEFAULT_TEXT_STYLE_ID],
  BUILTIN_SPINNER_STYLES[DEFAULT_SPINNER_STYLE_ID]
);

const readCustomDefinition = async (ref?: StatusIndicatorStyleRef): Promise<StatusIndicatorCustomDefinition | null> => {
  if (!ref?.path) return null;
  try {
    const exists = await pathExists(ref.path);
    if (!exists) return null;
    const content = await readJson(ref.path);
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
  const builtin = BUILTIN_TEXT_STYLES[canonicalStyleId(styleId)];
  if (builtin) return builtin;

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
  const builtin = BUILTIN_SPINNER_STYLES[canonicalStyleId(styleId)];
  if (builtin) return builtin;

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
  const options: Array<{ id: StatusTextStyleId; label: string; source: 'builtin' | 'custom'; path?: string }> = Object.values(BUILTIN_TEXT_STYLES).map(
    (style) => ({ id: style.id, label: style.label, source: 'builtin' })
  );

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
  const options: Array<{ id: StatusSpinnerStyleId; label: string; source: 'builtin' | 'custom'; path?: string }> = Object.values(BUILTIN_SPINNER_STYLES).map(
    (style) => ({ id: style.id, label: style.label, source: 'builtin' })
  );

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
