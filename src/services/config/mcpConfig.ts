import fs from 'fs-extra';
import path from 'path';
import type { McpConfig, ToolPermission, ToolPermissionValue } from '../../types/config.js';
import type { ToolName } from '../../types/tools.js';
import { ALL_TOOL_NAMES } from '../../types/tools.js';
import { TOOL_DEFAULTS } from './defaults.js';

export const normalizePermission = (
  value: ToolPermissionValue | undefined,
  defaults: ToolPermission
): ToolPermission => {
  if (typeof value === 'boolean') {
    return {
      allowed: value,
      require_approval: value ? defaults.require_approval ?? false : false,
    };
  }

  if (!value) {
    return { ...defaults };
  }

  return {
    allowed: value.allowed ?? defaults.allowed,
    require_approval: value.require_approval ?? defaults.require_approval ?? false,
    description: value.description ?? defaults.description,
  };
};

export const toolPermissionsOf = (mcp: McpConfig): Record<ToolName, ToolPermission> => {
  const permissions = {} as Record<ToolName, ToolPermission>;
  for (const toolName of ALL_TOOL_NAMES) {
    permissions[toolName] = normalizePermission(
      mcp.tools?.[toolName] as ToolPermissionValue | undefined,
      TOOL_DEFAULTS[toolName]
    );
  }
  return permissions;
};

export const readMcp = async (mcpPath: string, fallback: McpConfig): Promise<McpConfig> => {
  if (!(await fs.pathExists(mcpPath))) return fallback;
  return (await fs.readJson(mcpPath)) as McpConfig;
};

export const writeMcp = async (mcpPath: string, mcp: McpConfig): Promise<void> => {
  await fs.writeJson(mcpPath, mcp, { spaces: 2 });
};

export const mcpConfigPath = (jamDir: string, fileName: string) => path.join(jamDir, fileName);

export const upsertServer = <T extends { id: string }>(existing: T[] | undefined, server: T): T[] => {
  const servers = Array.isArray(existing) ? [...existing] : [];
  const index = servers.findIndex((entry) => entry.id === server.id);
  if (index >= 0) {
    servers[index] = { ...servers[index], ...server };
  } else {
    servers.push({ ...server });
  }
  return servers;
};
