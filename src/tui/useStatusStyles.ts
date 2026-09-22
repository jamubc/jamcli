import { useCallback } from 'react';
import { ConfigService } from '../services/ConfigService.js';
import {
  DEFAULT_CUSTOM_STYLE,
  DEFAULT_STATUS_STYLE,
  listStatusSpinnerStyleOptions,
  listStatusTextStyleOptions,
  resolveSpinnerStyle,
  resolveStatusStyle,
  resolveTextStyle,
} from '../styles/statusStyles.js';
import type { StatusSpinnerStyleDefinition, StatusTextStyleDefinition } from '../styles/statusStyles.js';
import type { StatusStyleOption } from './StatusStyleModal.js';
import type { UiConfig } from '../types/config.js';
import type { Message } from '../core/types.js';

interface StyleDeps {
  configService: ConfigService | null;
  uiConfig: UiConfig | null;
  addMessage: (msg: Message) => void;
  setUiConfig: (cfg: UiConfig) => void;
  setStatusStyle: (style: any) => void;
  setStatusStyleOptions: (options: StatusStyleOption[]) => void;
}

export function useStatusStyles({ configService, uiConfig, addMessage, setUiConfig, setStatusStyle, setStatusStyleOptions }: StyleDeps) {
  const refreshStatusStyles = useCallback(
    async (
      nextUiConfig?: UiConfig | null,
      overrides?: { textStyleId?: StatusTextStyleDefinition['id']; spinnerStyleId?: StatusSpinnerStyleDefinition['id'] }
    ) => {
      try {
        if (!configService) return;
        const cfg = nextUiConfig || uiConfig || (await configService.getUiConfig());
        setUiConfig(cfg);

        const resolved = await resolveStatusStyle({
          uiConfig: cfg,
          textStyleId: overrides?.textStyleId,
          spinnerStyleId: overrides?.spinnerStyleId,
        });
        setStatusStyle(resolved);

        const [textOptionsRaw, spinnerOptionsRaw] = await Promise.all([
          listStatusTextStyleOptions(cfg),
          listStatusSpinnerStyleOptions(cfg),
        ]);

        const [resolvedTextDefs, resolvedSpinnerDefs] = await Promise.all([
          Promise.all(textOptionsRaw.map((opt) => resolveTextStyle(opt.id, cfg))),
          Promise.all(spinnerOptionsRaw.map((opt) => resolveSpinnerStyle(opt.id, cfg))),
        ]);

        const options: StatusStyleOption[] = [
          ...textOptionsRaw.map((opt, idx) => ({
            kind: 'text' as const,
            id: opt.id,
            label: opt.label,
            description: opt.source === 'custom' ? opt.path : opt.source,
            source: opt.source,
            path: opt.path,
            textStyle: resolvedTextDefs[idx],
          })),
          ...spinnerOptionsRaw.map((opt, idx) => ({
            kind: 'spinner' as const,
            id: opt.id,
            label: opt.label,
            description: opt.source === 'custom' ? opt.path : opt.source,
            source: opt.source,
            path: opt.path,
            spinnerStyle: resolvedSpinnerDefs[idx],
          })),
          {
            kind: 'action',
            id: 'add_custom',
            label: 'Add custom style',
            description: 'Create a file in ~/.jamubc/status-styles',
          },
          {
            kind: 'action',
            id: 'manage_custom',
            label: 'Manage custom styles',
            description: 'Open the status-styles folder to edit/delete',
            meta: configService.getStatusStylesDirectory(),
          },
        ];
        setStatusStyleOptions(options);
      } catch (error: any) {
        console.error('Failed to refresh status styles', error);
        setStatusStyle(DEFAULT_STATUS_STYLE);
        setStatusStyleOptions([]);
      }
    },
    [configService, setUiConfig, uiConfig, setStatusStyle, setStatusStyleOptions]
  );

  const applyTextStyle = useCallback(
    async (styleId: StatusTextStyleDefinition['id'], opts?: { silent?: boolean; pathHint?: string }) => {
      if (!configService) return;
      try {
        const updatedUi = await configService.setStatusTextStyle(styleId);
        await refreshStatusStyles(updatedUi, { textStyleId: styleId });
        if (!opts?.silent) {
          const active = await resolveStatusStyle({ uiConfig: updatedUi, textStyleId: styleId });
          const pathNote = opts?.pathHint ? ` Edit at ${opts.pathHint}` : '';
          addMessage({
            role: 'system',
            content: `Text style set to "${active.label}".${pathNote}`,
            timestamp: Date.now(),
          });
        }
      } catch (error: any) {
        addMessage({
          role: 'system',
          content: `Failed to update text style: ${error.message}`,
          timestamp: Date.now(),
        });
      }
    },
    [addMessage, refreshStatusStyles, configService]
  );

  const applySpinnerStyle = useCallback(
    async (styleId: StatusSpinnerStyleDefinition['id'], opts?: { silent?: boolean; pathHint?: string }) => {
      if (!configService) return;
      try {
        const updatedUi = await configService.setStatusSpinnerStyle(styleId);
        await refreshStatusStyles(updatedUi, { spinnerStyleId: styleId });
        if (!opts?.silent) {
          const active = await resolveStatusStyle({ uiConfig: updatedUi, spinnerStyleId: styleId });
          const pathNote = opts?.pathHint ? ` Edit at ${opts.pathHint}` : '';
          addMessage({
            role: 'system',
            content: `Spinner set to "${active.label}".${pathNote}`,
            timestamp: Date.now(),
          });
        }
      } catch (error: any) {
        addMessage({
          role: 'system',
          content: `Failed to update spinner: ${error.message}`,
          timestamp: Date.now(),
        });
      }
    },
    [addMessage, refreshStatusStyles, configService]
  );

  const addCustomStatusStyle = useCallback(async () => {
    if (!configService) return;
    const existing = new Set(Object.keys(uiConfig?.custom_status_styles || {}));
    let suffix = existing.size + 1;
    let name = `custom-style-${suffix}`;
    while (existing.has(name)) {
      suffix += 1;
      name = `custom-style-${suffix}`;
    }
    try {
      const { path: stylePath, uiConfig: updatedUi } = await configService.ensureCustomStatusStyle(name, {
        ...DEFAULT_CUSTOM_STYLE,
        label: `Custom: ${name}`,
      });
      await applyTextStyle(`custom:${name}`, { pathHint: stylePath, silent: true });
      await applySpinnerStyle(`custom:${name}`, { pathHint: stylePath, silent: true });
      await refreshStatusStyles(updatedUi, { textStyleId: `custom:${name}`, spinnerStyleId: `custom:${name}` });
      addMessage({
        role: 'system',
        content: `Custom style "${name}" created. Edit at ${stylePath}.`,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to create custom style: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }, [addMessage, applySpinnerStyle, applyTextStyle, configService, refreshStatusStyles, uiConfig?.custom_status_styles]);

  const openStatusStyleFolderMessage = useCallback(() => {
    if (!configService) return;
    const folder = configService.getStatusStylesDirectory();
    addMessage({
      role: 'system',
      content: `Manage custom styles in: ${folder}\nEdit or remove JSON files to adjust shimmer/spinner colors.`,
      timestamp: Date.now(),
    });
  }, [addMessage, configService]);

  return {
    refreshStatusStyles,
    applyTextStyle,
    applySpinnerStyle,
    addCustomStatusStyle,
    openStatusStyleFolderMessage,
  };
}
