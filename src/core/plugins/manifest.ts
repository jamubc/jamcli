import fs from 'fs';
import path from 'path';
import semver from 'semver';
import { z } from 'zod';
import { JAMCLI_VERSION } from '../version.js';

export const MANIFEST_FILE = 'jamcli-plugin.json';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d+)?$/i;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A path inside the plugin, written relative to it. */
const inside = z
  .string()
  .min(1)
  .refine((value) => !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..'), 'must be a path inside the plugin');

const ManifestSchema = z.strictObject({
  name: z.string().max(64).regex(NAME, 'must be lowercase letters, digits, and single hyphens'),
  version: z.string().refine((value) => semver.valid(value) !== null, 'must be a semantic version such as 1.2.0'),
  description: z.string().max(1024).optional(),
  engines: z.strictObject({ jamcli: z.string().refine((value) => semver.validRange(value) !== null, 'must be a semver range such as >=2.0.0 <3') }).optional(),
  permissions: z
    .strictObject({
      network: z.array(z.string().regex(HOST, 'must be a host name')).optional(),
      env: z.array(z.string().regex(ENV_NAME, 'must be an environment variable name')).optional(),
      filesystem: z.enum(['none', 'project']).optional(),
    })
    .optional(),
  contributes: z
    .strictObject({
      commands: inside.optional(),
      skills: inside.optional(),
      hooks: inside.optional(),
      mcpServers: z.record(z.string().regex(NAME, 'must be lowercase letters, digits, and single hyphens'), z.strictObject({ command: z.string().min(1), args: z.array(z.string()).optional() })).optional(),
    })
    .optional(),
});

export type PluginManifest = z.infer<typeof ManifestSchema>;

import type { PluginPermissions } from './lock.js';

export type { PluginPermissions };

/** What a plugin may reach, with the defaults filled in: nothing unless it asks. */
export const permissionsOf = (manifest: PluginManifest): PluginPermissions => ({
  network: [...(manifest.permissions?.network ?? [])].sort(),
  env: [...(manifest.permissions?.env ?? [])].sort(),
  filesystem: manifest.permissions?.filesystem ?? 'none',
});

/** Read and check a plugin's manifest. Throws with every problem, each naming its field. */
export function readManifest(dir: string, version = JAMCLI_VERSION): PluginManifest {
  const file = path.join(dir, MANIFEST_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error: any) {
    throw new Error(`${file} could not be read: ${error?.code === 'ENOENT' ? 'there is no such file' : error?.message ?? error}`);
  }
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${file} is not a valid plugin manifest: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'the file'} ${issue.message}`).join('; ')}`);
  }
  const manifest = parsed.data;
  if (manifest.engines?.jamcli && !semver.satisfies(version, manifest.engines.jamcli, { includePrerelease: true })) {
    throw new Error(`${manifest.name} ${manifest.version} needs JamCLI ${manifest.engines.jamcli}, and this is ${version}.`);
  }
  for (const [key, relative] of Object.entries({ commands: manifest.contributes?.commands, skills: manifest.contributes?.skills, hooks: manifest.contributes?.hooks })) {
    if (relative && !fs.existsSync(path.join(dir, relative))) throw new Error(`${manifest.name} contributes ${key} at ${relative}, which does not exist.`);
  }
  return manifest;
}

/** Each thing a plugin adds, as a line a person reads before consenting. */
export function describeContributions(dir: string, manifest: PluginManifest): string[] {
  const lines: string[] = [];
  const listed = (relative: string, pick: (entry: fs.Dirent) => boolean) =>
    fs
      .readdirSync(path.join(dir, relative), { withFileTypes: true })
      .filter(pick)
      .map((entry) => entry.name.replace(/\.md$/, ''))
      .sort();
  const contributes = manifest.contributes ?? {};
  if (contributes.commands) lines.push(`commands: ${listed(contributes.commands, (entry) => entry.isFile() && entry.name.endsWith('.md')).map((name) => `/${manifest.name}:${name}`).join(', ') || 'none'}`);
  if (contributes.skills) lines.push(`skills: ${listed(contributes.skills, (entry) => entry.isDirectory()).join(', ') || 'none'}`);
  if (contributes.hooks) {
    const hooks = JSON.parse(fs.readFileSync(path.join(dir, contributes.hooks), 'utf8')) as Record<string, { command: string }[]>;
    for (const [event, list] of Object.entries(hooks)) for (const hook of list ?? []) lines.push(`hook on ${event}: ${hook.command}`);
  }
  for (const [id, server] of Object.entries(contributes.mcpServers ?? {})) lines.push(`MCP server ${id}: ${[server.command, ...(server.args ?? [])].join(' ')}`);
  return lines;
}

/** The permissions as lines, for consent and for `update`'s difference. */
export const describePermissions = (permissions: PluginPermissions): string[] => [
  `network: ${permissions.network.length ? permissions.network.join(', ') : 'none'}`,
  `environment variables: ${permissions.env.length ? permissions.env.join(', ') : 'none'}`,
  `files: ${permissions.filesystem === 'project' ? 'may write the project' : 'read-only'}`,
];

/** What `next` may reach that `before` could not; empty when it asks for nothing more. */
export function widened(before: PluginPermissions, next: PluginPermissions): string[] {
  const added: string[] = [];
  for (const host of next.network) if (!before.network.includes(host)) added.push(`network: ${host}`);
  for (const name of next.env) if (!before.env.includes(name)) added.push(`environment variable: ${name}`);
  if (next.filesystem === 'project' && before.filesystem !== 'project') added.push('files: may write the project');
  return added;
}
