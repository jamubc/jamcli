import { useCallback } from 'react';
import { HistoryService, SessionMetadata } from '../services/HistoryService.js';
import { ConfigService } from '../services/ConfigService.js';
import { ModelService } from '../services/ModelService.js';
import {
  CONFIGURE_ENTRY_ID,
  CONFIGURE_MODELS_ENTRY,
  SESSION_PAGE_SIZE,
  initialModelMenuState,
  initialSessionMenuState,
} from './layoutState.js';
import type { ConfigWizardState, ModelMenuState, SessionMenuState } from './layoutState.js';
import type { ModelInfo, Profile } from '../types/config.js';
import type { Message } from '../core/types.js';

interface MenuDeps {
  activeProfile: Profile | null;
  projectRoot: string;
  modelService: ModelService | null;
  configService: ConfigService | null;
  addMessage: (msg: Message) => void;
  setConfig: (config: any) => void;
  setActiveProfile: (profile: Profile) => void;
  setAvailableModels: (models: ModelInfo[]) => void;
  setModelDetail: (model: ModelInfo | null) => void;
  setModelMenuState: (state: ModelMenuState | ((prev: ModelMenuState) => ModelMenuState)) => void;
  setSessionMenuState: (state: SessionMenuState | ((prev: SessionMenuState) => SessionMenuState)) => void;
  setConfigWizard: (wizard: ConfigWizardState) => void;
  setIsConfigMenuOpen: (open: boolean) => void;
  modelMenuState: ModelMenuState;
  sessionMenuState: SessionMenuState;
  configWizard: ConfigWizardState;
  modelDetail: ModelInfo | null;
  recordModelUsage: (provider: string, model: string) => void;
  resumeSession: (sessionId: string, projectRoot?: string) => Promise<boolean>;
}

export function useModelSessionMenus(deps: MenuDeps) {
  const {
    activeProfile,
    projectRoot,
    modelService,
    configService,
    addMessage,
    setConfig,
    setActiveProfile,
    setAvailableModels,
    setModelDetail,
    setModelMenuState,
    setSessionMenuState,
    setConfigWizard,
    setIsConfigMenuOpen,
    modelMenuState,
    sessionMenuState,
    configWizard,
    modelDetail,
    recordModelUsage,
    resumeSession,
  } = deps;

  const refreshAvailableModels = useCallback(async () => {
    if (!modelService) return [];
    try {
      const models = await modelService.listAvailableModels();
      setAvailableModels(models);
      return models;
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to list models: ${error.message}`,
        timestamp: Date.now(),
      });
      return [];
    }
  }, [addMessage, setAvailableModels, modelService]);

  const openModelMenu = useCallback(
    (models: ModelInfo[]) => {
      setModelDetail(null);
      const currentModel = activeProfile?.preferred_model;
      const currentProvider = activeProfile?.preferred_provider;
      const defaultId = currentModel && currentProvider ? `${currentProvider}:${currentModel}` : null;

      const filteredModels = models.filter((model) => model.id !== CONFIGURE_ENTRY_ID);
      setAvailableModels(filteredModels);
      const menuModels = [CONFIGURE_MODELS_ENTRY, ...filteredModels];

      const fallbackIndex = menuModels.length > 1 ? 1 : 0;
      let selectedIndex = defaultId ? menuModels.findIndex((model) => model.id === defaultId) : -1;
      if (selectedIndex < 0 && currentModel) {
        selectedIndex = menuModels.findIndex((model) => model.id.endsWith(`:${currentModel}`));
      }

      setModelMenuState({
        open: true,
        models: menuModels,
        selectedIndex: selectedIndex >= 0 ? selectedIndex : fallbackIndex,
        searchQuery: '',
      });
    },
    [activeProfile?.preferred_model, activeProfile?.preferred_provider, setAvailableModels, setModelMenuState, setModelDetail]
  );

  const closeModelMenu = useCallback(() => {
    setModelDetail(null);
    setModelMenuState((prev) => ({ ...prev, open: false }));
  }, [setModelDetail, setModelMenuState]);

  const openSessionMenu = useCallback(async () => {
    try {
      const history = new HistoryService(projectRoot);
      await history.initialize();
      const sessions = await history.listSessions(100);

      if (sessions.length === 0) {
        addMessage({
          role: 'system',
          content: 'No previous sessions found.',
          timestamp: Date.now(),
        });
        return;
      }

      setSessionMenuState({
        open: true,
        sessions,
        allSessions: sessions,
        selectedIndex: 0,
        searchQuery: '',
        currentPage: 0,
      });
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to load sessions: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }, [addMessage, projectRoot, setSessionMenuState]);

  const closeSessionMenu = useCallback(() => setSessionMenuState(initialSessionMenuState), [setSessionMenuState]);

  const handleSessionSearch = useCallback(async (query: string) => {
    setSessionMenuState(prev => {
      if (!query.trim()) {
        return {
          ...prev,
          searchQuery: query,
          sessions: prev.allSessions,
          selectedIndex: 0,
          currentPage: 0,
        };
      }

      const filtered = prev.allSessions.filter(session => {
        const searchableText = [
          session.title || '',
          session.firstUserMessage || '',
          session.projectName,
          session.id,
        ].join(' ').toLowerCase();

        return searchableText.includes(query.toLowerCase());
      });

      return {
        ...prev,
        searchQuery: query,
        sessions: filtered,
        selectedIndex: 0,
        currentPage: 0,
      };
    });
  }, [setSessionMenuState]);

  const handleModelSearchChange = useCallback((query: string) => {
    setModelDetail(null);
    setModelMenuState((prev) => ({ ...prev, searchQuery: query, selectedIndex: 0 }));
  }, [setModelDetail, setModelMenuState]);

  const changeSessionPage = useCallback((direction: 'prev' | 'next') => {
    setSessionMenuState((prev) => {
      if (!prev.sessions.length) {
        return prev;
      }

      const totalPages = Math.ceil(prev.sessions.length / SESSION_PAGE_SIZE);

      let newPage = prev.currentPage;
      if (direction === 'next' && prev.currentPage < totalPages - 1) {
        newPage = prev.currentPage + 1;
      } else if (direction === 'prev' && prev.currentPage > 0) {
        newPage = prev.currentPage - 1;
      }

      const newIndex = Math.min(newPage * SESSION_PAGE_SIZE, prev.sessions.length - 1);

      return { ...prev, currentPage: newPage, selectedIndex: newIndex };
    });
  }, [setSessionMenuState]);

  const handleSessionResume = useCallback(async (sessionId: string, messages: Message[]) => {
    const success = await resumeSession(sessionId, projectRoot);

    if (success) {
      addMessage({
        role: 'system',
        content: `📜 Resumed session: ${sessionId}\nLoaded ${messages.length} messages from history.`,
        timestamp: Date.now(),
      });
    } else {
      addMessage({
        role: 'system',
        content: `Failed to resume session: ${sessionId}`,
        timestamp: Date.now(),
      });
    }
  }, [resumeSession, projectRoot, addMessage]);

  const handleModelSwitch = useCallback(async (modelId: string) => {
    if (!modelService) {
      addMessage({
        role: 'system',
        content: 'Model service is still initializing. Try again in a moment.',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      const updatedProfile = await modelService.switchModel(modelId);
      setActiveProfile(updatedProfile);
      recordModelUsage(updatedProfile.preferred_provider || 'ollama', updatedProfile.preferred_model || modelId);
      addMessage({
        role: 'system',
        content: `Model switched to: ${updatedProfile.preferred_model} (${updatedProfile.preferred_provider || 'ollama'})`,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to switch model: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }, [modelService, addMessage, setActiveProfile, recordModelUsage]);

  const updateToolModelFilterSetting = useCallback(
    async (enabled: boolean) => {
      if (!configService) {
        addMessage({
          role: 'system',
          content: 'Configuration service is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        const updatedConfig = await configService.updateGeneralSettings({
          show_tool_calling_models_only: enabled,
        });
        setConfig(updatedConfig);
        addMessage({
          role: 'system',
          content: enabled
            ? 'Showing only tool-calling OpenRouter models.'
            : 'Showing all OpenRouter models.',
          timestamp: Date.now(),
        });
        await refreshAvailableModels();
      } catch (error: any) {
        addMessage({
          role: 'system',
          content: `Failed to update general settings: ${error.message}`,
          timestamp: Date.now(),
        });
      }
    },
    [addMessage, refreshAvailableModels, setConfig, configService]
  );

  const reopenModelMenu = useCallback(async () => {
    const models = await refreshAvailableModels();
    openModelMenu(models);
  }, [openModelMenu, refreshAvailableModels]);

  return {
    openModelMenu,
    closeModelMenu,
    openSessionMenu,
    closeSessionMenu,
    handleSessionSearch,
    handleModelSearchChange,
    changeSessionPage,
    handleSessionResume,
    handleModelSwitch,
    refreshAvailableModels,
    updateToolModelFilterSetting,
    reopenModelMenu,
  };
}

export type { SessionMetadata };
