import { useCallback } from 'react';
import { ConfigService } from '../services/ConfigService.js';
import type { ProviderSlug, ConfigWizardState } from './layoutState.js';
import type { Message } from '../core/types.js';
import type { Config, UiConfig } from '../types/config.js';

interface WizardDeps {
  configService: ConfigService | null;
  configWizard: ConfigWizardState;
  addMessage: (msg: Message) => void;
  setConfig: (config: Config) => void;
  setConfigWizard: (wizard: ConfigWizardState | ((prev: ConfigWizardState) => ConfigWizardState)) => void;
  setIsConfigMenuOpen: (open: boolean) => void;
  returnToModelMenuRef: { current: boolean };
  refreshStatusStyles: (uiConfig?: UiConfig | null) => Promise<void>;
  refreshAvailableModels: () => Promise<unknown[]>;
  reopenModelMenu: () => Promise<void>;
}

export function useConfigWizard({
  configService,
  configWizard,
  addMessage,
  setConfig,
  setConfigWizard,
  setIsConfigMenuOpen,
  returnToModelMenuRef,
  refreshStatusStyles,
  refreshAvailableModels,
  reopenModelMenu,
}: WizardDeps) {
  const openConfigMenu = useCallback(
    async (options?: { returnToModels?: boolean }) => {
      if (!configService) {
        addMessage({
          role: 'system',
          content: 'Configuration service is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }

      if (typeof options?.returnToModels === 'boolean') {
        returnToModelMenuRef.current = options.returnToModels;
      }

      try {
        const cfg = await configService.getConfig();
        setConfig(cfg);
        await refreshStatusStyles();
        setIsConfigMenuOpen(true);
      } catch (error: any) {
        addMessage({
          role: 'system',
          content: `Failed to load configuration: ${error.message}`,
          timestamp: Date.now(),
        });
      }
    },
    [addMessage, setConfig, setIsConfigMenuOpen, refreshStatusStyles, configService, returnToModelMenuRef]
  );

  const closeConfigMenu = useCallback(async () => {
    setIsConfigMenuOpen(false);
    const shouldReturn = returnToModelMenuRef.current;
    returnToModelMenuRef.current = false;
    if (shouldReturn) {
      await reopenModelMenu();
    }
  }, [reopenModelMenu, setIsConfigMenuOpen, returnToModelMenuRef]);

  const updateConfigWizardForm = useCallback((field: string, value: string) => {
    setConfigWizard((prev) => (prev ? { ...prev, form: { ...prev.form, [field]: value } } : prev));
  }, [setConfigWizard]);

  const cancelConfigWizard = useCallback(() => {
    setConfigWizard(null);
    void openConfigMenu();
  }, [openConfigMenu, setConfigWizard]);

  const removeProvider = useCallback(
    async (provider: ProviderSlug) => {
      if (!configService) {
        addMessage({
          role: 'system',
          content: 'Configuration service is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        const updated = await configService.removeProvider(provider);
        setConfig(updated);
        addMessage({
          role: 'system',
          content: `${provider === 'ollama' ? 'Ollama' : 'OpenRouter'} provider removed.`,
          timestamp: Date.now(),
        });
        await refreshAvailableModels();
        await openConfigMenu();
      } catch (error: any) {
        addMessage({
          role: 'system',
          content: `Failed to update providers: ${error.message}`,
          timestamp: Date.now(),
        });
      }
    },
    [addMessage, openConfigMenu, refreshAvailableModels, setConfig, configService]
  );

  const handleConfigWizardSubmit = useCallback(async () => {
    if (!configWizard || configWizard.mode !== 'provider') return;
    if (!configService) {
      addMessage({
        role: 'system',
        content: 'Configuration service is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      if (configWizard.provider === 'ollama') {
        const endpoint = (configWizard.form.endpoint || '').trim() || 'http://localhost:11434';
        const updatedConfig = await configService.updateProvider('ollama', endpoint);
        setConfig(updatedConfig);
        addMessage({
          role: 'system',
          content: `Ollama endpoint set to ${endpoint}`,
          timestamp: Date.now(),
        });
      } else {
        const apiKey = (configWizard.form.apiKey || '').trim();
        if (!apiKey) {
          addMessage({
            role: 'system',
            content: 'Please enter an API key to continue.',
            timestamp: Date.now(),
          });
          return;
        }
        const updatedConfig = await configService.updateProvider('openrouter', apiKey);
        setConfig(updatedConfig);
        addMessage({
          role: 'system',
          content: 'OpenRouter API key saved.',
          timestamp: Date.now(),
        });
      }
      setConfigWizard(null);
      await refreshAvailableModels();
      await openConfigMenu();
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to save provider: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }, [addMessage, configWizard, openConfigMenu, refreshAvailableModels, setConfig, setConfigWizard, configService]);

  return {
    openConfigMenu,
    closeConfigMenu,
    updateConfigWizardForm,
    cancelConfigWizard,
    removeProvider,
    handleConfigWizardSubmit,
  };
}
