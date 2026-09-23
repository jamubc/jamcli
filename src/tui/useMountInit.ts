import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ConfigService } from '../services/ConfigService.js';
import { ModelService } from '../services/ModelService.js';
import { McpManager } from '../services/McpManager.js';
import { ToolService } from '../services/ToolService.js';
import {
  DEFAULT_STATUS_STYLE,
} from '../styles/statusStyles.js';
import type {
  StatusSpinnerStyleDefinition,
  StatusStyleDefinition,
  StatusTextStyleDefinition,
} from '../styles/statusStyles.js';
import type { Config, ModelInfo, Profile, UiConfig } from '../types/config.js';
import type { McpServerConfig } from '../types/mcp.js';
import { resetTerminalViewport } from './layoutState.js';

interface MountInitDeps {
  projectRoot: string;
  setConfig: (config: Config) => void;
  setActiveProfile: (profile: Profile) => void;
  setAvailableModels: Dispatch<SetStateAction<ModelInfo[]>>;
  setStatusStyle: Dispatch<SetStateAction<StatusStyleDefinition>>;
  refreshStatusStyles: (
    nextUiConfig?: UiConfig | null,
    overrides?: { textStyleId?: StatusTextStyleDefinition['id']; spinnerStyleId?: StatusSpinnerStyleDefinition['id'] }
  ) => Promise<void>;
  refreshMcpServers: () => Promise<McpServerConfig[]>;
  initializeHistory: (projectRoot?: string, sessionId?: string) => Promise<void>;
  configServiceRef: { current: ConfigService | null };
  toolServiceRef: { current: ToolService | null };
  modelServiceRef: { current: ModelService | null };
  mcpManagerRef: { current: McpManager | null };
}

export function useMountInit({
  projectRoot,
  setConfig,
  setActiveProfile,
  setAvailableModels,
  setStatusStyle,
  refreshStatusStyles,
  refreshMcpServers,
  initializeHistory,
  configServiceRef,
  toolServiceRef,
  modelServiceRef,
  mcpManagerRef,
}: MountInitDeps) {
  useEffect(() => {
    resetTerminalViewport();
    const init = async () => {
      if (process.cwd() !== projectRoot) {
        try {
          process.chdir(projectRoot);
        } catch (error) {
          console.error('Failed to switch to project root:', error);
        }
      }
      const freshConfigService = new ConfigService(projectRoot);
      configServiceRef.current = freshConfigService;
      await freshConfigService.initialize();
      const loadedConfig = await freshConfigService.getConfig();
      const profile = await freshConfigService.getActiveProfile();
      setConfig(loadedConfig);
      setActiveProfile(profile);
      toolServiceRef.current = new ToolService({ projectRoot, configService: freshConfigService });

      const freshModelService = new ModelService(freshConfigService);
      modelServiceRef.current = freshModelService;
      const freshMcpManager = new McpManager({ configService: freshConfigService });
      mcpManagerRef.current = freshMcpManager;
      await refreshMcpServers();
      try {
        const preloadModels = await freshModelService.listAvailableModels();
        setAvailableModels(preloadModels);
      } catch {
        // Ignore preload failures; handled when user opens the model menu.
      }

      try {
        const uiCfg = await freshConfigService.getUiConfig();
        await refreshStatusStyles(uiCfg);
      } catch (error: any) {
        console.error('Failed to load UI config; using defaults.', error);
        setStatusStyle(DEFAULT_STATUS_STYLE);
      }

      // Initialize history service
      await initializeHistory(projectRoot);
    };

    init();
    // Run once on mount; avoid tying to callbacks that change with state.
  }, [projectRoot]);
}
