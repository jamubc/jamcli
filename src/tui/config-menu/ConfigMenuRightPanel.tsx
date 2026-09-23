import { Box, Text } from 'ink';
import { MenuEmptyState, MenuHint } from '../menu/MenuPrimitives.js';
import { StatusStylePreview } from '../StatusStylePreview.js';
import { buildStatusStyle } from '../../styles/statusStyles.js';
import type { StatusSpinnerStyleDefinition, StatusTextStyleDefinition } from '../../styles/statusStyles.js';
import type { Config } from '../../types/config.js';
import type { McpServerConfig, McpTestResult } from '../../types/mcp.js';
import type { StatusStyleOption } from '../StatusStyleModal.js';
import { SectionDivider } from './ConfigMenuPrimitives.js';
import type { MenuState } from './menuModel.js';

type TextStyleOption = Extract<StatusStyleOption, { kind: 'text' }>;
type SpinnerStyleOption = Extract<StatusStyleOption, { kind: 'spinner' }>;

export interface ConfigMenuRightPanelProps {
  activeMenu: MenuState;
  config: Config;
  mcpServers: McpServerConfig[];
  mcpTestResults: Record<string, McpTestResult>;
  mcpConfigPath: string;
  systemPrompt?: string;
  styleFilter: string;
  fallbackTextStyle: StatusTextStyleDefinition | undefined;
  fallbackSpinnerStyle: StatusSpinnerStyleDefinition | undefined;
  defaultTextOpt: TextStyleOption | undefined;
  defaultSpinnerOpt: SpinnerStyleOption | undefined;
  activeTextOpt: TextStyleOption | undefined;
  activeSpinnerOpt: SpinnerStyleOption | undefined;
  activeTextId: string | undefined;
  activeSpinnerId: string | undefined;
  activeStatusSummary: string;
  selectedStyleOption: StatusStyleOption | undefined;
}

export const ConfigMenuRightPanel = ({
  activeMenu,
  config,
  mcpServers,
  mcpTestResults,
  mcpConfigPath,
  systemPrompt,
  styleFilter,
  fallbackTextStyle,
  fallbackSpinnerStyle,
  defaultTextOpt,
  defaultSpinnerOpt,
  activeTextOpt,
  activeSpinnerOpt,
  activeTextId,
  activeSpinnerId,
  activeStatusSummary,
  selectedStyleOption,
}: ConfigMenuRightPanelProps) => {
    const mcpServerIndex = activeMenu.selectedIndex - 2;
    if (activeMenu.id === 'main') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="cyan">System Status</Text>
          <Text>Active Profile: {config.active_profile}</Text>
          <Text>Telemetry: {config.telemetry ? 'Enabled' : 'Disabled'}</Text>
          <Box marginTop={1}>
             <Text color="gray">Select a category on the left to configure.</Text>
          </Box>
        </Box>
      );
    }
    if (activeMenu.id === 'providers') {
       return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="cyan">Providers</Text>
          <Text>Manage your AI model providers here.</Text>
          <Text color="gray">Ollama is for local models.</Text>
          <Text color="gray">OpenRouter provides access to cloud models.</Text>
        </Box>
        );
    }
    if (activeMenu.id === 'general') {
      const toolFilterEnabled = config.general?.show_tool_calling_models_only ?? false;
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="cyan">General Settings</Text>
          <Text>Tool filter: {toolFilterEnabled ? 'Only tool-capable models' : 'All models'}</Text>
          <Box marginTop={1}>
            <Text color="gray">When enabled, OpenRouter model listings will only include models that advertise tool support.</Text>
            <Text color="gray">Useful for keeping the model picker focused on tool-calling capable options.</Text>
          </Box>
        </Box>
      );
    }
    if (activeMenu.id === 'context') {
      const ctx = config.context_management;
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="cyan">Context Management</Text>
          <Text>Status: {ctx?.enabled ? 'Enabled' : 'Disabled'}</Text>
          <Text>Max tokens: {ctx?.max_tokens ?? '8000 (default)'}</Text>
          <Text>Threshold: {ctx ? `${Math.round((ctx.compression_threshold || 1) * 100)}%` : '90%'}</Text>
          <Text>Strategy: {ctx?.strategy || 'summarize'}</Text>
          <Box marginTop={1}>
            <Text color="gray">Summaries keep the system prompt and the last few messages.</Text>
            <Text color="gray">Truncate keeps the system prompt plus the most recent messages under the limit.</Text>
          </Box>
        </Box>
      );
    }
    if (activeMenu.id === 'ollama') {
        return (
            <Box flexDirection="column" gap={1}>
              <Text bold color="cyan">Ollama Configuration</Text>
              <Text>Endpoint: {config.api_registry.ollama?.endpoint || 'http://localhost:11434'}</Text>
              <Text color="gray">Ensure Ollama is running locally.</Text>
            </Box>
        );
    }
    if (activeMenu.id === 'telemetry') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="cyan">Telemetry</Text>
          <Text>{config.telemetry ? 'Telemetry is enabled.' : 'Telemetry is disabled.'}</Text>
          <Text color="gray">JamCLI only sends telemetry when enabled. Toggle to opt in or out.</Text>
        </Box>
      );
    }
    if (activeMenu.id === 'openrouter') {
        return (
            <Box flexDirection="column" gap={1}>
              <Text bold color="cyan">OpenRouter Configuration</Text>
              <Text>Key: {config.api_registry.openrouter?.api_key ? '********' : 'Not set'}</Text>
            </Box>
        );
    }
    if (activeMenu.id === 'mcp') {
      const selectedServer = mcpServers[mcpServerIndex];
      const testResult = selectedServer ? mcpTestResults[selectedServer.id] : undefined;
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="cyan">MCP Servers</Text>
          <Text color="gray">Config file: {mcpConfigPath}</Text>
          <Text color="gray">Hotkeys: [A]dd · [T]est · [E]dit · [D]elete · [C]opy path · [O]pen file</Text>
          {selectedServer ? (
            <>
              <SectionDivider />
              <Text>Server: {selectedServer.id}</Text>
              <Text>Command: {selectedServer.command}</Text>
              <Text>Args: {selectedServer.args?.join(' ') || '(none)'}</Text>
              <Text>Transport: {(selectedServer.transport || 'stdio').toUpperCase()}</Text>
              <Text>Working dir: {selectedServer.cwd || 'Project root'}</Text>
              {testResult ? (
                <Text color={testResult.status === 'ok' ? 'green' : 'red'}>
                  Last test: {testResult.status.toUpperCase()} · {testResult.message}
                  {testResult.latencyMs ? ` · ${testResult.latencyMs} ms` : ''}
                </Text>
              ) : (
                <Text color="gray">Run a test to see status.</Text>
              )}
            </>
          ) : (
            <Text color="gray">Select a server to view config and test results.</Text>
          )}
        </Box>
      );
    }
    if (activeMenu.id === 'style') {
      if (!fallbackTextStyle || !fallbackSpinnerStyle) {
        return <MenuEmptyState message="No styles are available yet. Add or reload styles." />;
      }

      if (!selectedStyleOption) {
        return (
          <MenuEmptyState
            message={styleFilter ? `No styles match "${styleFilter}"` : 'No status styles found. Add one to preview it.'}
          />
        );
      }

      if (selectedStyleOption.kind === 'action') {
        const buttonLabel =
          selectedStyleOption.id === 'manage_custom'
            ? '[ Open styles directory (O) ]'
            : '[ Add custom style (A) ]';
        return (
          <Box flexDirection="column" gap={1}>
            <Text color="gray" bold>
              Action
            </Text>
            <Box borderStyle="round" borderColor="yellow" paddingX={1} paddingY={0}>
              <Text color="yellow">{buttonLabel}</Text>
            </Box>
            {selectedStyleOption.description && <Text color="gray">{selectedStyleOption.description}</Text>}
            {selectedStyleOption.meta && <Text color="gray">Location: {selectedStyleOption.meta}</Text>}
            <MenuHint text="Enter to run · Hotkeys: A or O while selected" />
          </Box>
        );
      }

      const previewStyle =
        selectedStyleOption.kind === 'text'
          ? buildStatusStyle(selectedStyleOption.textStyle, activeSpinnerOpt?.spinnerStyle || fallbackSpinnerStyle)
          : buildStatusStyle(activeTextOpt?.textStyle || fallbackTextStyle, selectedStyleOption.spinnerStyle);
      const previewLabel =
        selectedStyleOption.kind === 'text'
          ? `${selectedStyleOption.label} + ${activeSpinnerOpt?.label || defaultSpinnerOpt?.label || 'Spinner'}`
          : `${activeTextOpt?.label || defaultTextOpt?.label || 'Text'} + ${selectedStyleOption.label}`;
      const isActive =
        (selectedStyleOption.kind === 'text' && selectedStyleOption.id === activeTextId) ||
        (selectedStyleOption.kind === 'spinner' && selectedStyleOption.id === activeSpinnerId);

      return (
        <Box flexDirection="column" gap={1}>
          <Text color="gray" bold>
            Preview (Not Saved)
          </Text>
          <StatusStylePreview
            optionLabel={previewLabel}
            optionSource={selectedStyleOption.source}
            path={selectedStyleOption.path}
            style={previewStyle}
            isActive={isActive}
          />
          <SectionDivider />
          <Box flexDirection="column" gap={0}>
            <Text color="gray" bold>Current Config</Text>
            <Text>Active: {activeStatusSummary}</Text>
            <Text color="gray">
              Text: {activeTextOpt?.label || defaultTextOpt?.label || 'Default'} · Spinner:{' '}
              {activeSpinnerOpt?.label || defaultSpinnerOpt?.label || 'Default'}
            </Text>
          </Box>
          {!isActive && <MenuHint text="Press Enter to apply this choice." />}
        </Box>
      );
    }
    if (activeMenu.id === 'prompt') {
        return (
            <Box flexDirection="column" gap={1}>
                <Text bold color="cyan">System Prompt</Text>
                <Text>{systemPrompt || '(default)'}</Text>
                <Box marginTop={1}>
                  <Text color="gray">Use /config prompt set &lt;text&gt; to update.</Text>
                </Box>
            </Box>
        );
    }
    return null;
};
