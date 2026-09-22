import React from 'react';
import { Box, Text } from 'ink';
import { MenuSurface, MenuSearchInput, MenuHint } from './menu/MenuPrimitives.js';
import type { McpServerConfig } from '../types/mcp.js';

export type McpServerForm = {
  id: string;
  command: string;
  args: string;
  cwd: string;
  env: string;
  transport: 'stdio' | 'sse';
};

interface McpServerModalProps {
  visible: boolean;
  action: 'add' | 'edit';
  form: McpServerForm;
  server?: McpServerConfig;
  onChange: (field: keyof McpServerForm, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const McpServerModal = ({
  visible,
  action,
  form,
  server,
  onChange,
  onSubmit,
  onCancel,
}: McpServerModalProps) => {
  if (!visible) return null;

  const title = action === 'add' ? 'Add MCP server' : `Edit MCP: ${server?.id || form.id}`;
  const transportLabel = form.transport === 'sse' ? 'SSE (web)' : 'STDIO (default)';

  return (
    <MenuSurface
      title={title}
      borderColor="yellow"
      footer={<MenuHint text="Enter to save · Esc cancel · Use Tab/Shift+Tab to cycle fields" />}
    >
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Text color="gray">
          JamCLI will store this entry in `.jamcli/mcp.json`. The command must be accessible from this shell.
        </Text>
        <MenuSearchInput
          label="Server ID"
          value={form.id}
          onChange={(value) => onChange('id', value)}
          isFocused={true}
          placeholder="developer"
        />
        <MenuSearchInput
          label="Command"
          value={form.command}
          onChange={(value) => onChange('command', value)}
          placeholder="/path/to/your/server"
        />
        <MenuSearchInput
          label="Args"
          value={form.args}
          onChange={(value) => onChange('args', value)}
          placeholder="--serve --stdio"
        />
        <MenuSearchInput
          label="Working dir"
          value={form.cwd}
          onChange={(value) => onChange('cwd', value)}
          placeholder="Optional, defaults to project root"
        />
        <MenuSearchInput
          label="Env (KEY=value; separate entries with ';')"
          value={form.env}
          onChange={(value) => onChange('env', value)}
          placeholder="FOO=bar;BAZ=qux"
        />
        <MenuSearchInput
          label="Transport"
          value={form.transport}
          onChange={(value) => onChange('transport', value)}
          placeholder="stdio"
        />
        <Text color="gray">Current transport hint: {transportLabel}</Text>
        <Text color="gray">
          When editing, leave the ID unchanged or the entry will be replaced. Command args split on whitespace; env entries split on ';'.
        </Text>
      </Box>
    </MenuSurface>
  );
};
