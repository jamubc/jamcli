import type { AgentEvent, ApprovalPreview, JamSession, RunResult } from '../types.js';
import type { RestorePreview } from '../git/checkpoints.js';
import type { ChatProvider } from '../providers/types.js';
import type { HookCommand } from '../hooks/commands.js';
import type { EditorBridge } from '../../types/tools.js';
import type { McpSource, ToolSummary } from './tools.js';
import type { ParentSession } from './children.js';
import type { CheckpointInfo } from './checkpoints.js';
import type { Gate } from '../verify/index.js';
import type { EffortLevel, ReasoningLevel } from '../routing/capabilities.js';
import type { EditableRuleScope } from './permissions.js';
import type { PermissionFlags } from '../permissions/config.js';
import type { PermissionMode } from '../permissions/modes.js';
import type { WorkItem } from '../work.js';
import type { TypedPrompt } from '../transcript/read.js';
import type { Decision, Rule } from '../permissions/rules.js';
import type { Sandbox, SandboxKind } from '../sandbox/index.js';
import type { ModelChoice } from './model.js';
import type { Skill } from '../ext/skills.js';
import type { ModelInfo } from '../catalog/index.js';
import type { SpendSummary } from '../catalog/cost.js';
import type { ObserveSettings } from '../observe/setup.js';
import type { Observer, Span } from '../observe/observer.js';

/** The surface a runtime serves. It is recorded with every decision in the session log. */
export type Surface = 'tui' | 'headless' | 'acp' | 'workflow' | 'child';

export interface RuntimeOptions {
  projectRoot: string;
  /**
   * Where the work happens when it is not the project root: the git worktree a
   * `--worktree` session or an isolated task runs in. Tools, rules, `@` references, and
   * checkpoints use it; configuration, grants, and the session log stay with the project.
   */
  workTree?: string;
  /** Where `@` references resolve. Defaults to the work tree. */
  cwd?: string;
  surface: Surface;
  /** Continue this session. It must exist. */
  sessionId?: string;
  /** `provider:model`, or a model on the profile's provider. */
  model?: string;
  /** The reasoning level every request asks for. The agent loop's default when absent. */
  reasoning?: ReasoningLevel;
  /** How hard the model thinks on every request, where it takes a level. */
  effort?: EffortLevel;
  /** Descriptions to offer instead of tools' own, by name: how a trial compares tool prompts. */
  toolDescriptions?: Record<string, string>;
  /** A delegated run's agent rules, read before the project's, which win a conflict. */
  agentRules?: { agent: string; source: string; text: string };
  /** `--allow-tool` names for this run. */
  allowTools?: string[];
  /** `--deny-tool` names for this run. */
  denyTools?: string[];
  /** `--allowed-tools`, `--disallowed-tools`, and `--permission-mode`. */
  permissions?: Omit<PermissionFlags, 'allowTools' | 'denyTools'>;
  /** `--dangerously-bypass-permissions`: start in bypass mode. */
  bypassPermissions?: boolean;
  /** `--dry-run`: make no change, and report each call that would have made one. */
  dryRun?: boolean;
  /** The sandbox commands run in. Detected from the platform and `sandbox` settings when not given. */
  sandbox?: Sandbox;
  maxSteps?: number;
  signal?: AbortSignal;
  /** Serve this provider instead of building one from configuration. */
  provider?: ChatProvider;
  /** Where MCP tools come from; `false` offers none. Defaults to the configured servers. */
  mcp?: McpSource | false;
  /** The environment credentials are redacted from. Defaults to the process environment. */
  env?: Record<string, string | undefined>;
  /** Set on a delegated run: the session that started it, whose policy it decides with. */
  parent?: ParentSession;
  /** Set on a delegated run the person can look in on: what they have said to it since it last asked. */
  heard?: () => string[];
  /** Log level and files, from `-v`, `--log-file`, and `--trace-file`. The environment is read when absent. */
  observe?: ObserveSettings;
  /** Record into this observer instead, under `parentSpan`: a delegated run shares its parent's. */
  observer?: { observer: Observer; parentSpan?: Span };
  /** What an ACP editor lends the session's own tools: its files and its terminal. */
  editor?: EditorBridge;
}

/** An MCP server's prompt. */
export interface McpPrompt {
  serverId: string;
  name: string;
  description?: string;
  arguments: { name: string; description?: string; required?: boolean }[];
}

/** How one turn differs from the session's, as a custom command's front matter asks. */
export interface RunOptions {
  /** Run this turn on this model, then return to the session's. */
  model?: string;
  /** Narrow the tools for this turn to these rules; nothing is allowed that was not already. */
  allowedTools?: string[];
  /** What narrows them, such as `/review`, for the reason a refused call gives. */
  label?: string;
  /** The input is a command the person typed after `!`: run it as `run_command`, without the model. */
  shell?: boolean;
  /** Call this tool once, without the model, as a workflow's `tool` step does. The input is what the log shows. */
  tool?: { name: string; arguments: Record<string, unknown> };
  /** Hidden tools offered for this turn only, such as `/reflect`'s, so no other turn pays for their schemas. */
  offer?: string[];
}

export interface ContextUsage {
  /** Estimated tokens of the next request, corrected by what the provider has reported. */
  used: number;
  /** The model's context window. */
  window: number;
  /** What a request may use: the window, less the output reserve and a margin. */
  budget: number;
  /** Where compaction starts. */
  trigger: number;
  /** The factor learned from the provider's counts; 1 until it has reported one. */
  correction: number;
  autoCompact: boolean;
  /** False when the window is a guess, which is compacted against only when the provider refuses a request. */
  windowKnown: boolean;
}

/** A call a dry run did not make: what it would have done. */
export interface DryRunEntry {
  callId: string;
  tool: string;
  summary: string;
  preview?: ApprovalPreview;
}

/** How a session's turns think. Absent parts are left to the model's default. */
export interface Thinking {
  reasoning?: ReasoningLevel;
  effort?: EffortLevel;
}

export interface Runtime {
  readonly sessionId: string;
  /** Where the tools work: the project root, or the worktree the session runs in. */
  readonly workRoot: string;
  /** The provider and model turns run on. */
  readonly model: ModelChoice;
  /** What the catalog knows about that model: its limits, capabilities, and prices, and where each came from. */
  readonly modelInfo: ModelInfo;
  /** What the session has cost so far, by model, with requests that had no known price counted apart. */
  spend(): SpendSummary;
  /** How much of what the session sent the provider had cached, and how often the request prefix changed. */
  cacheStats(): { promptTokens: number; cachedTokens: number; cacheBreaks: number };
  /** The gates this project declares, which the harness runs after edits and before a turn ends with them. */
  readonly gates: Gate[];
  /**
   * Render the handoff from the log now, marked for the next session to read on its first
   * turn, as `/handoff` asks. Resolves to nothing when the session has no messages yet.
   */
  handoff(): Promise<{ path: string; bytes: number } | undefined>;
  /** How full the context is: the next request's estimate against the model's budget. */
  contextUsage(): ContextUsage;
  /**
   * Summarize the older part of the conversation now, giving particular attention to
   * `focus`, as `/compact` does. Resolves false when there is nothing to compact.
   */
  compact(focus?: string, onEvent?: (event: AgentEvent) => void): Promise<boolean>;
  /** What the model is offered, with schemas. */
  readonly tools: ToolSummary[];
  /** The conversation so far, as the next request will carry it. */
  readonly session: JamSession;
  /** Problems found while assembling, also reported as notices by the first turn. */
  readonly notices: string[];
  /**
   * The notices the first turn would report, handed over now instead: a surface that
   * shows them when the session opens takes them, so the turn does not report them again.
   */
  takeNotices(): string[];
  /** The skills found, which the system prompt lists and the skill tool loads. */
  readonly skills: Skill[];
  /** The language servers that can run here, by name. */
  readonly lspServers: string[];
  /** The prompts the MCP servers offer, each of which becomes `/server:name`. */
  mcpPrompts(): Promise<McpPrompt[]>;
  /** A server's prompt, filled in, as the text of one message. */
  mcpPrompt(serverId: string, name: string, args: Record<string, string>): Promise<string>;
  /** The resources the MCP servers offer, each of which can be referred to as `@server:uri`. */
  mcpResources(): Promise<{ serverId: string; uri: string; name: string; description?: string }[]>;
  /** The configured hooks, and whether the project's are trusted to run. */
  hooks(): { hooks: HookCommand[]; projectTrusted: boolean };
  /** Trust the project's hooks as they are now, for this and later sessions, and start running them. */
  trustProjectHooks(): void;
  readonly permissionMode: PermissionMode;
  /** Where commands run: `bwrap`, `seatbelt`, or `none`, with the reason. */
  readonly sandbox: { kind: SandboxKind; reason: string };
  /** In a dry run, every call that would have changed something, with its preview. */
  readonly dryRunReport: DryRunEntry[];
  /** Switch permission modes for later calls. Returns why not, changing nothing, when the mode is unavailable. */
  setPermissionMode(mode: PermissionMode, options?: { bypassConfirmed?: boolean }): string | undefined;
  /** Every rule deciding calls now, lowest scope first, each with its scope and source. */
  permissionRules(): Rule[];
  /**
   * Add a rule for this session, or save it in the user's, the project's, or the
   * project-local configuration. It applies to the next call. Returns why not, changing
   * nothing, when the rule does not parse, the file cannot be written, or a turn is running.
   */
  addPermissionRule(decision: Decision, text: string, scope: EditableRuleScope): string | undefined;
  /**
   * Remove every rule written as `text` from the scopes a person edits: the session and
   * the user, project, and project-local files. Built-in rules, the run's flags, and the
   * legacy `.jamcli/mcp.json` block are kept, and returned as such.
   */
  removePermissionRule(text: string): { removed: Rule[]; kept: Rule[]; error?: string };
  run(input: string, onEvent?: (event: AgentEvent) => void, options?: RunOptions): Promise<RunResult>;
  cancel(): void;
  /** Switch the provider and model for later turns. Throws if the provider is not configured. */
  setModel(ref: string): void;
  /** How later turns think: the reasoning switch and, where the model takes one, the effort level. */
  readonly thinking: Thinking;
  /** Change how later turns think. An empty value returns to the model's default. */
  setThinking(next: Thinking): void;
  /**
   * Every model the configured providers list, each with what the catalog knows of it
   * without asking further, and why any provider could not be asked. Each provider has
   * `timeoutMs` to answer, and one that does not is left out.
   */
  listModels(timeoutMs?: number): Promise<{ models: ModelInfo[]; problems: string[] }>;
  /** Copy this session, up to an event, into a new one, and return the new id. */
  fork(atEvent?: number): string;
  /** The checkpoints this session took before its changes, oldest first. */
  checkpoints(): CheckpointInfo[];
  /** What restoring checkpoint `n` would change in the working copy. */
  previewCheckpoint(n: number): Promise<RestorePreview>;
  /**
   * Put the working copy back as checkpoint `n` found it, after taking a checkpoint of how
   * it is now, so the restore can itself be undone. Refused while a turn runs.
   */
  restoreCheckpoint(n: number): Promise<string[]>;
  /**
   * Run a change the person asked for, such as reverting a hunk, between two checkpoints,
   * so /rewind can take it back. Refused while a turn runs.
   */
  withCheckpoint<T>(label: string, change: () => Promise<T>, files?: string[]): Promise<T>;
  /** Ask this session's model for a conventional commit message for what would be committed. */
  draftCommitMessage(paths?: string[], signal?: AbortSignal): Promise<string>;
  /**
   * One request to this session's model, outside the conversation, such as for a pull
   * request's description. It is counted and priced like the session's other requests.
   */
  complete(prompt: string, options?: { maxOutputTokens?: number; signal?: AbortSignal }): Promise<string>;
  /** What runs beside the turn, and what ended lately: background commands and child agents. */
  work(): WorkItem[];
  /** Called whenever that changes, between turns included; returns how to stop listening. */
  watchWork(listener: () => void): () => void;
  /** Stop one of them. False when nothing by that id is running. */
  stopWork(id: string): boolean;
  /** What one child agent has done so far, as its own events, oldest first, for looking in on it. */
  workEvents(id: string): AgentEvent[];
  /** Each further event of that child as it happens; returns how to stop listening. */
  watchWorkEvents(id: string, listener: (event: AgentEvent) => void): () => void;
  /** Say something to a running child; it reads it with its next step. False when nothing by that id runs. */
  sayToWork(id: string, text: string): boolean;
  /**
   * Plant a tester's note at this point of the session log. Notes are for people reading
   * the session back; the model never sees them.
   */
  note(text: string): void;
  /** Record what the person typed in the composer, sent or cleared away, for recall. It is never sent to the model. */
  prompt(text: string, state: 'sent' | 'cleared'): void;
  /** What the person typed in this session, oldest first, including before a compaction. */
  prompts(): TypedPrompt[];
  /** The notes planted in this session, oldest first. */
  notes(): SessionNote[];
  close(): Promise<void>;
}

/** A tester's note as the session log holds it. */
export interface SessionNote {
  text: string;
  ts: number;
}
