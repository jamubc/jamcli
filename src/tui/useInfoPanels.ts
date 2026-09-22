import { useCallback } from 'react';
import { ConfigService } from '../services/ConfigService.js';
import { McpManager } from '../services/McpManager.js';
import { describeToolMode, formatProviderSummary, formatToolStatusTable } from './layoutFormat.js';
import type { ProviderSlug } from './layoutState.js';
import { TOOL_DEFINITIONS } from '../types/tools.js';
import type { ToolName } from '../types/tools.js';
import type { Config, ToolPermission } from '../types/config.js';
import type { Profile } from '../types/config.js';
import type { Message } from '../core/types.js';

interface InfoDeps {
  configService: ConfigService | null;
  mcpManager: McpManager | null;
  addMessage: (msg: Message) => void;
  setConfig: (config: Config) => void;
  setActiveProfile: (profile: Profile) => void;
  setMcpServers: (servers: any[]) => void;
}

export function useInfoPanels({ configService, mcpManager, addMessage, setConfig, setActiveProfile, setMcpServers }: InfoDeps) {
  const showToolStatus = useCallback(async () => {
    if (!configService) {
      addMessage({
        role: 'system',
        content: 'Tool registry is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return false;
    }
    try {
      const permissions = await configService.getToolPermissions();
      addMessage({ role: 'system', content: formatToolStatusTable(permissions), timestamp: Date.now() });
      return true;
    } catch (error: any) {
      addMessage({ role: 'system', content: `Failed to load tools: ${error.message}`, timestamp: Date.now() });
      return false;
    }
  }, [addMessage, configService]);

  const showMcpServers = useCallback(async () => {
    if (!mcpManager) {
      addMessage({
        role: 'system',
        content: 'MCP manager is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }
    try {
      const summary = await mcpManager.describeServers();
      addMessage({ role: 'system', content: summary, timestamp: Date.now() });
    } catch (error: any) {
      addMessage({ role: 'system', content: `Failed to load MCP servers: ${error.message}`, timestamp: Date.now() });
    }
  }, [addMessage, mcpManager]);

  const showMcpTools = useCallback(async () => {
    if (!mcpManager) {
      addMessage({
        role: 'system',
        content: 'MCP manager is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }
    try {
      const summary = await mcpManager.describeTools();
      addMessage({ role: 'system', content: summary, timestamp: Date.now() });
    } catch (error: any) {
      addMessage({ role: 'system', content: `Failed to load MCP tools: ${error.message}`, timestamp: Date.now() });
    }
  }, [addMessage, mcpManager]);

  const upsertMcpServer = useCallback(
    async (id: string, command: string, args: string[] = [], cwd?: string) => {
      if (!mcpManager) {
        addMessage({
          role: 'system',
          content: 'MCP manager is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        await mcpManager.upsertServer({ id, command, args, cwd, enabled: true });
        addMessage({
          role: 'system',
          content: `MCP server saved: ${id} (${command}${args.length ? ' ' + args.join(' ') : ''})`,
          timestamp: Date.now(),
        });
        await showMcpServers();
      } catch (error: any) {
        addMessage({ role: 'system', content: `Failed to save MCP server: ${error.message}`, timestamp: Date.now() });
      }
    },
    [addMessage, showMcpServers, mcpManager]
  );

  const removeMcpServer = useCallback(
    async (id: string) => {
      if (!mcpManager) {
        addMessage({
          role: 'system',
          content: 'MCP manager is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        await mcpManager.removeServer(id);
        if (configService) {
          const servers = await configService.listMcpServers();
          setMcpServers(servers);
        }
        addMessage({ role: 'system', content: `Removed MCP server: ${id}`, timestamp: Date.now() });
        await showMcpServers();
      } catch (error: any) {
        addMessage({ role: 'system', content: `Failed to remove MCP server: ${error.message}`, timestamp: Date.now() });
      }
    },
    [addMessage, showMcpServers, mcpManager, configService, setMcpServers]
  );

  const updateToolPermissionSetting = useCallback(
    async (toolName: ToolName, updates: Partial<ToolPermission>, actionLabel: string) => {
      if (!configService) {
        addMessage({
          role: 'system',
          content: 'Tool registry is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        const updated = await configService.updateToolPermission(toolName, updates);
        const description = `${TOOL_DEFINITIONS[toolName].label} ${actionLabel}. Mode: ${describeToolMode(updated)}.`;
        addMessage({ role: 'system', content: description, timestamp: Date.now() });
      } catch (error: any) {
        addMessage({ role: 'system', content: `Failed to update ${toolName}: ${error.message}`, timestamp: Date.now() });
      }
    },
    [addMessage, configService]
  );

  const showProviderSettings = useCallback(async () => {
    if (!configService) {
      addMessage({
        role: 'system',
        content: 'Configuration service is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }
    try {
      const cfg = await configService.getConfig();
      addMessage({ role: 'system', content: formatProviderSummary(cfg), timestamp: Date.now() });
    } catch (error: any) {
      addMessage({ role: 'system', content: `Failed to load providers: ${error.message}`, timestamp: Date.now() });
    }
  }, [addMessage, configService]);

  const updateProviderSetting = useCallback(
    async (provider: ProviderSlug, value?: string) => {
      if (!configService) {
        addMessage({
          role: 'system',
          content: 'Configuration service is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        const updatedConfig = await configService.updateProvider(provider, value);
        setConfig(updatedConfig);
        const detail = provider === 'ollama'
          ? `Ollama endpoint set to ${updatedConfig.api_registry.ollama?.endpoint}`
          : 'OpenRouter API key updated.';
        addMessage({ role: 'system', content: detail, timestamp: Date.now() });
      } catch (error: any) {
        addMessage({ role: 'system', content: `Failed to update provider: ${error.message}`, timestamp: Date.now() });
      }
    },
    [addMessage, setConfig, configService]
  );

  const showConfigMenu = useCallback(async () => {
    if (!configService) {
      addMessage({
        role: 'system',
        content: 'Configuration service is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }
    try {
      const cfg = await configService.getConfig();
      const profile = await configService.getActiveProfile();
      const summary = [
        'Configuration menu:',
        `Active profile: ${cfg.active_profile}`,
        `Preferred model: ${profile.preferred_model || 'n/a'} (${profile.preferred_provider || 'provider?'})`,
        `Telemetry: ${cfg.telemetry ? 'enabled' : 'disabled'}`,
        '',
        'System prompt (first 200 chars):',
        profile.system_prompt_override?.slice(0, 200) || '(not set)',
        '',
        'Commands:',
        '/config prompt show  – view current system prompt',
        '/config prompt set <text>  – update system prompt',
        '/tools status  – manage tool permissions',
      ].join('\n');
      addMessage({ role: 'system', content: summary, timestamp: Date.now() });
    } catch (error: any) {
      addMessage({ role: 'system', content: `Failed to load config: ${error.message}`, timestamp: Date.now() });
    }
  }, [addMessage, configService]);

  const showSystemPrompt = useCallback(async () => {
    if (!configService) {
      addMessage({
        role: 'system',
        content: 'Configuration service is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }
    try {
      const profile = await configService.getActiveProfile();
      const prompt = profile.system_prompt_override || '(not set)';
      addMessage({ role: 'system', content: `Current system prompt:\n\n${prompt}`, timestamp: Date.now() });
    } catch (error: any) {
      addMessage({ role: 'system', content: `Failed to read system prompt: ${error.message}`, timestamp: Date.now() });
    }
  }, [addMessage, configService]);

  const updateSystemPromptSetting = useCallback(
    async (newPrompt: string) => {
      if (!configService) {
        addMessage({
          role: 'system',
          content: 'Configuration service is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        const updatedProfile = await configService.updateSystemPrompt(newPrompt);
        setActiveProfile(updatedProfile);
        addMessage({ role: 'system', content: 'System prompt updated.', timestamp: Date.now() });
      } catch (error: any) {
        addMessage({ role: 'system', content: `Failed to update prompt: ${error.message}`, timestamp: Date.now() });
      }
    },
    [addMessage, setActiveProfile, configService]
  );

  return {
    showToolStatus,
    showMcpServers,
    showMcpTools,
    upsertMcpServer,
    removeMcpServer,
    updateToolPermissionSetting,
    showProviderSettings,
    updateProviderSetting,
    showConfigMenu,
    showSystemPrompt,
    updateSystemPromptSetting,
  };
}
