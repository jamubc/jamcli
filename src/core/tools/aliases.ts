import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { globRunner } from './glob.js';
import { grepRunner } from './grep.js';

/**
 * The original interface's names for listing and searching. They stay registered so
 * permission files, profiles, and older sessions that name them keep working, but they
 * are hidden: the model is offered only `glob` and `grep`, one tool per job.
 */

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function listFilesAlias(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  return globRunner(
    {
      pattern: args.pattern,
      limit: args.limit,
      include_hidden: args.include_hidden,
      include_dirs: args.include_dirs,
    },
    ctx
  );
}

async function searchCodeAlias(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const regex = args.regex && typeof args.regex.pattern === 'string' ? args.regex : undefined;
  if (!regex && (typeof args.query !== 'string' || !args.query)) {
    throw new Error('search_code requires a "query" string or "regex" pattern.');
  }
  return grepRunner(
    {
      pattern: regex ? regex.pattern : escapeRegex(args.query),
      case_sensitive: regex ? !String(regex.flags ?? '').includes('i') : Boolean(args.case_sensitive),
      glob: args.pattern,
      limit: args.limit,
      include_hidden: args.include_hidden,
    },
    ctx
  );
}

const listFilesSchema: JsonSchema = {
  type: 'object',
  properties: {
    pattern: { type: 'string', description: 'Glob pattern to match.' },
    limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Maximum number of paths.' },
    include_hidden: { type: 'boolean', description: 'Include hidden entries.' },
    include_dirs: { type: 'boolean', description: 'Include directories.' },
  },
  required: [],
  additionalProperties: false,
};

const searchCodeSchema: JsonSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Literal text to search for.' },
    regex: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression source.' },
        flags: { type: 'string', description: 'Regular expression flags.' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    pattern: { type: 'string', description: 'Glob limiting which files are searched.' },
    limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Maximum number of matches.' },
    include_hidden: { type: 'boolean', description: 'Include hidden entries.' },
    case_sensitive: { type: 'boolean', description: 'Match case for a literal query.' },
  },
  required: [],
  additionalProperties: false,
};

export const ALIAS_TOOLS: RegisteredTool[] = [
  {
    name: 'list_files',
    description: 'Alias of glob.',
    inputSchema: listFilesSchema,
    policy: 'read',
    runner: listFilesAlias,
    hidden: true,
    aliasOf: 'glob',
  },
  {
    name: 'search_code',
    description: 'Alias of grep.',
    inputSchema: searchCodeSchema,
    policy: 'read',
    runner: searchCodeAlias,
    hidden: true,
    aliasOf: 'grep',
  },
];
