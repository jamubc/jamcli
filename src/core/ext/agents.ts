import fs from 'fs';
import path from 'path';
import type { CategoryChain, CategoryEntry, Config } from '../../types/config.js';
import { userConfigDir } from '../../utils/paths.js';
import { parseFrontMatter } from './frontmatter.js';
import { skillNameProblem } from './skills.js';
import { pluginAgentDirs } from '../plugins/load.js';
import { EFFORT_LEVELS, isEffortLevel, providerConfigured, providerOf, type EffortLevel } from '../routing/capabilities.js';
import { describeChain } from '../routing/categories.js';

/**
 * Delegation agents: `agents/<name>.md`, whose front matter gives the agent's
 * `description` and `models`, the chain it runs on, and whose body is its rules, which
 * only a child running on it reads. The four built-ins are agents too: they have no chain
 * and run on the session's model, whatever provider serves it, and a file of the same
 * name replaces one. The earlier `categories` configuration loads as agents with no
 * description and no rules, so a file written before agents existed routes as it did.
 */

export type AgentScope = 'project' | 'user' | 'plugin';

export type AgentSource = { kind: 'file'; path: string; scope: AgentScope } | { kind: 'categories' } | { kind: 'builtin' };

export interface Agent {
  name: string;
  /** What the model reads when choosing. A category has none. */
  description?: string;
  /** Tried in order. Empty for an agent that runs on the session's model. */
  chain: CategoryChain;
  /** No chain of its own: the child runs on whatever model the session is using. */
  inherits?: boolean;
  /** The effort a child on the session's model runs at. A chain entry carries its own. */
  effort?: EffortLevel;
  /** The body of the agent's file: rules its child reads before the project's. */
  rules?: string;
  source: AgentSource;
}

export interface LoadedAgents {
  agents: Record<string, Agent>;
  /** The agent a `task` call without one runs on, when there is one. */
  defaultAgent?: string;
  problems: string[];
}

/**
 * The built-ins run on the session's model, as Claude Code's subagents do by default, so
 * delegation works with whichever provider the person uses, a local one included, with
 * nothing to configure. A file of the same name gives one a chain of its own.
 */
const inherited = { chain: [] as CategoryChain, inherits: true, source: { kind: 'builtin' } as const };

export const BUILTIN_AGENTS: readonly Agent[] = [
  {
    name: 'quick',
    description: 'Small, well-specified jobs with a short answer: a lookup, a single-file check, one piece of a fan-out.',
    ...inherited,
  },
  {
    name: 'intelligent',
    description: 'Hard problems where getting it right matters more than speed: a subtle bug, a change that crosses several modules.',
    ...inherited,
  },
  {
    name: 'explore',
    description: 'Investigation across the codebase: where something lives, how two parts connect, what calls what. Ask it to report, not to edit.',
    ...inherited,
  },
  {
    name: 'writing',
    description: 'Prose: documentation, a commit message, a summary for the person.',
    ...inherited,
  },
];

/** The agent a call without one runs on when only the built-ins are in effect. */
export const BUILTIN_DEFAULT_AGENT = 'quick';

const KNOWN_KEYS = new Set(['description', 'model', 'models', 'effort']);
const REASONING = new Set(['off', 'on', 'auto']);

/** Where agent files are found, the first shadowing the later: the project's, the user's, then plugins'. */
export function agentDirs(projectRoot: string): { scope: AgentScope; dir: string }[] {
  return [
    { scope: 'project', dir: path.join(projectRoot, '.jamcli', 'agents') },
    { scope: 'user', dir: path.join(userConfigDir(), 'agents') },
    ...pluginAgentDirs(projectRoot).map((dir) => ({ scope: 'plugin' as const, dir })),
  ];
}

const entryOf = (value: unknown): CategoryEntry | string => {
  if (typeof value === 'string') return value.trim() ? { model: value.trim() } : 'an entry in models is empty';
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'an entry in models is neither a model nor { model, reasoning }';
  const { model, reasoning, effort } = value as Record<string, unknown>;
  if (typeof model !== 'string' || !model.trim()) return 'an entry in models has no model';
  if (reasoning !== undefined && !REASONING.has(String(reasoning))) return `the reasoning of ${model} is not off, on, or auto`;
  if (effort !== undefined && !isEffortLevel(effort)) return `the effort of ${model} is not one of ${EFFORT_LEVELS.join(', ')}`;
  return {
    model: model.trim(),
    ...(reasoning !== undefined ? { reasoning: String(reasoning) as CategoryEntry['reasoning'] } : {}),
    ...(effort !== undefined ? { effort: effort as EffortLevel } : {}),
  };
};

/** Read one agent file. Problems that do not stop it from loading come back as `notes`. */
export function readAgent(file: string, scope: AgentScope): { agent: Agent; notes: string[] } | { problem: string } {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error: any) {
    return { problem: `${file}: ${error?.message ?? error}` };
  }
  const { data, body, error } = parseFrontMatter(text);
  if (error) return { problem: `${file}: ${error}.` };
  const name = path.basename(file, '.md');
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  // `model` names one; `models` a chain tried in order. Neither: the session's model.
  const listed = data.models ?? data.model;
  const entries = Array.isArray(listed) ? listed.map(entryOf) : listed !== undefined ? [entryOf(listed)] : [];
  const bad = entries.find((entry): entry is string => typeof entry === 'string');
  const effort = data.effort;
  const problem =
    skillNameProblem(name) ??
    (!description ? 'it has no description' : undefined) ??
    (data.model !== undefined && data.models !== undefined ? 'it names both model and models; use one' : undefined) ??
    (listed !== undefined && !entries.length ? 'it names no models' : undefined) ??
    bad ??
    (effort !== undefined && !isEffortLevel(effort) ? `its effort is not one of ${EFFORT_LEVELS.join(', ')}` : undefined);
  if (problem) return { problem: `${file}: ${problem}.` };
  const rules = body.trim();
  const notes = Object.keys(data)
    .filter((key) => !KNOWN_KEYS.has(key))
    .map((key) => `${file}: ${key} is not a key this version knows, so it is ignored.`);
  // The agent's effort applies to every entry that does not set its own.
  const chain = (entries as CategoryEntry[]).map((entry) => (isEffortLevel(effort) && !entry.effort ? { ...entry, effort } : entry));
  return {
    agent: {
      name,
      description,
      chain,
      ...(chain.length ? {} : { inherits: true }),
      ...(!chain.length && isEffortLevel(effort) ? { effort } : {}),
      ...(rules ? { rules } : {}),
      source: { kind: 'file', path: file, scope },
    },
    notes,
  };
}

/**
 * Every agent in effect: files over `categories` over the built-ins, and the default. A
 * session loads this once, so the list the model is shown and the routing it gets agree.
 */
export function loadAgents(projectRoot: string, config: Pick<Config, 'categories' | 'delegation'>): LoadedAgents {
  const agents: Record<string, Agent> = {};
  const problems: string[] = [];
  const configured = config.categories && Object.keys(config.categories).length ? config.categories : undefined;
  // Configured categories replace the built-ins, as they always have.
  if (configured) {
    for (const [name, chain] of Object.entries(configured)) if (chain.length) agents[name] = { name, chain, source: { kind: 'categories' } };
  } else {
    for (const agent of BUILTIN_AGENTS) agents[agent.name] = agent;
  }
  const fromFiles = new Set<string>();
  for (const { scope, dir } of agentDirs(projectRoot)) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue;
      const read = readAgent(path.join(dir, entry.name), scope);
      if ('problem' in read) {
        problems.push(read.problem);
        continue;
      }
      problems.push(...read.notes);
      if (fromFiles.has(read.agent.name)) continue;
      fromFiles.add(read.agent.name);
      agents[read.agent.name] = read.agent;
    }
  }
  const named = config.delegation?.default_agent?.trim();
  let defaultAgent: string | undefined;
  if (named) {
    if (agents[named]) defaultAgent = named;
    else problems.push(`delegation.default_agent names ${named}, which is not an agent. The agents are ${Object.keys(agents).sort().join(', ')}.`);
  } else if (!configured && agents[BUILTIN_DEFAULT_AGENT]) {
    defaultAgent = BUILTIN_DEFAULT_AGENT;
  }
  return { agents, ...(defaultAgent ? { defaultAgent } : {}), problems };
}

/** The chains alone, keyed by agent, which is what routing reads. */
export const chainsOf = (agents: Record<string, Agent>): Record<string, CategoryChain> =>
  Object.fromEntries(Object.values(agents).map((agent) => [agent.name, agent.chain]));

/**
 * The agents worth offering: one on the session's model, or one with a chain entry on a
 * configured provider. No network.
 */
export const routableAgents = (agents: Record<string, Agent>, registry: Config['api_registry']): Agent[] =>
  Object.values(agents)
    .filter((agent) => agent.inherits || agent.chain.some((entry) => providerConfigured(registry, providerOf(entry.model))))
    .sort((a, b) => a.name.localeCompare(b.name));

/** What an agent runs on, in words. */
export const describeRun = (agent: Pick<Agent, 'chain' | 'inherits' | 'effort'>): string =>
  agent.inherits ? `the session model${agent.effort ? ` (effort ${agent.effort})` : ''}` : describeChain(agent.chain);

/** Where an agent came from, in words. */
export const describeSource = (source: AgentSource, label: (file: string) => string = (file) => file): string =>
  source.kind === 'file' ? label(source.path) : source.kind === 'categories' ? 'the categories configuration' : 'built-in';
