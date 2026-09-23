import { useCallback } from 'react';
import clipboard from 'clipboardy';
import { spawn } from 'child_process';
import { ConfigService } from '../services/ConfigService.js';
import { McpManager } from '../services/McpManager.js';
import { McpTestService } from '../services/McpTestService.js';
import type { ConfigWizardState } from './layoutState.js';
import type { McpServerConfig, McpTestResult } from '../types/mcp.js';
import type { Message } from '../core/types.js';

interface McpDeps {
  configService: ConfigService | null;
  mcpManager: McpManager | null;
  testService: McpTestService;
  projectRoot: string;
  configWizard: ConfigWizardState;
  mcpServers: McpServerConfig[];
  addMessage: (msg: Message) => void;
  setConfigWizard: (wizard: ConfigWizardState) => void;
  setMcpTestResults: (updater: (prev: Record<string, McpTestResult>) => Record<string, McpTestResult>) => void;
  refreshMcpServers: () => Promise<unknown[]>;
  openConfigMenu: (options?: { returnToModels?: boolean }) => Promise<void>;
}

export function useMcpPanels({
  configService,
  mcpManager,
  testService,
  projectRoot,
  configWizard,
  mcpServers,
  addMessage,
  setConfigWizard,
  setMcpTestResults,
  refreshMcpServers,
  openConfigMenu,
}: McpDeps) {
  const openAddMcpWizard = useCallback(() => {
    setConfigWizard({
      mode: 'mcp',
      action: 'add',
      form: {
        id: '',
        command: '',
        args: '',
        cwd: projectRoot,
        env: '',
        transport: 'stdio',
      },
    });
  }, [projectRoot, setConfigWizard]);

  const openEditMcpWizard = useCallback(
    (server: McpServerConfig) => {
      const envEntries = server.env
        ? Object.entries(server.env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')
        : '';
      setConfigWizard({
        mode: 'mcp',
        action: 'edit',
        server,
        form: {
          id: server.id,
          command: server.command,
          args: (server.args || []).join(' '),
          cwd: server.cwd || projectRoot,
          env: envEntries,
          transport: server.transport === 'sse' ? 'sse' : 'stdio',
        },
      });
    },
    [projectRoot, setConfigWizard]
  );

  const handleMcpWizardSubmit = useCallback(async () => {
    if (!configWizard || configWizard.mode !== 'mcp') return;
    if (!mcpManager) {
      addMessage({
        role: 'system',
        content: 'MCP manager is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }

    const form = configWizard.form;
    const id = form.id.trim();
    const command = form.command.trim();
    if (!id || !command) {
      addMessage({
        role: 'system',
        content: 'Provide both an ID and command for the MCP server.',
        timestamp: Date.now(),
      });
      return;
    }

    const args = form.args
      .split(/\s+/)
      .map((arg) => arg.trim())
      .filter(Boolean);
    const envLines = form.env
      .split(/[;\r?\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const env: Record<string, string> = {};
    envLines.forEach((line) => {
      const [key, ...rest] = line.split('=');
      if (!key) return;
      env[key.trim()] = rest.join('=').trim();
    });

    try {
      const next: McpServerConfig = {
        id,
        command,
        args,
        env: Object.keys(env).length ? env : undefined,
        cwd: form.cwd?.trim() || undefined,
        transport: form.transport === 'sse' ? 'sse' : 'stdio',
        enabled: true,
      };
      await mcpManager.upsertServer(next);
      await refreshMcpServers();
      addMessage({
        role: 'system',
        content: `${configWizard.action === 'add' ? 'Added' : 'Updated'} MCP server: ${id}`,
        timestamp: Date.now(),
      });
      setConfigWizard(null);
      await openConfigMenu();
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to save MCP server: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }, [addMessage, configWizard, mcpManager, refreshMcpServers, openConfigMenu, setConfigWizard]);

  const handleTestMcpServer = useCallback(
    async (server: McpServerConfig) => {
      setMcpTestResults((prev) => ({
        ...prev,
        [server.id]: {
          status: 'failed',
          message: 'Testing...',
          timestamp: Date.now(),
        },
      }));

      try {
        const result = await testService.testServer(server, projectRoot);
        setMcpTestResults((prev) => ({ ...prev, [server.id]: result }));
        addMessage({
          role: 'system',
          content: `MCP ${server.id} test: ${result.status === 'ok' ? 'OK' : 'FAILED'} - ${result.message}`,
          timestamp: Date.now(),
        });
      } catch (error: any) {
        setMcpTestResults((prev) => ({
          ...prev,
          [server.id]: {
            status: 'failed',
            message: error?.message || 'Test failed',
            timestamp: Date.now(),
          },
        }));
        addMessage({
          role: 'system',
          content: `MCP ${server.id} test failed: ${error?.message || 'Unknown error'}`,
          timestamp: Date.now(),
        });
      }
    },
    [addMessage, projectRoot, testService, setMcpTestResults]
  );

  const handleTestAllMcpServers = useCallback(async () => {
    for (const server of mcpServers) {
      await handleTestMcpServer(server);
    }
  }, [handleTestMcpServer, mcpServers]);

  const copyMcpConfigPath = useCallback(async () => {
    if (!configService) return;
    try {
      clipboard.writeSync(configService.getMcpConfigPath());
      addMessage({
        role: 'system',
        content: 'MCP config path copied to clipboard.',
        timestamp: Date.now(),
      });
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to copy MCP path: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }, [addMessage, configService]);

  const openMcpConfigFile = useCallback(() => {
    if (!configService) return;
    const editor = process.env.EDITOR;
    if (!editor) {
      addMessage({
        role: 'system',
        content: 'Set $EDITOR to open the MCP config file.',
        timestamp: Date.now(),
      });
      return;
    }

    const proc = spawn(editor, [configService.getMcpConfigPath()], {
      stdio: 'inherit',
    });

    proc.on('error', (error) => {
      addMessage({
        role: 'system',
        content: `Failed to open editor: ${error.message}`,
        timestamp: Date.now(),
      });
    });
  }, [addMessage, configService]);

  return {
    openAddMcpWizard,
    openEditMcpWizard,
    handleMcpWizardSubmit,
    handleTestMcpServer,
    handleTestAllMcpServers,
    copyMcpConfigPath,
    openMcpConfigFile,
  };
}
