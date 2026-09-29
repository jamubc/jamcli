import { estimateRequest } from '../context/estimate.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolSet } from './tools.js';

/** The task and delegate families are offered once one of them has started, not before. */
const FAMILY_TOOLS = new Set(['task_status', 'task_result', 'task_cancel', 'delegate_status', 'delegate_result', 'delegate_cancel']);

export interface ToolOfferOptions {
  registry: ToolRegistry;
  /** Each MCP tool's server, by tool name. */
  mcpServers?: Map<string, string>;
  /** Past this many MCP tools, they are offered through `search_tools` rather than in every request. */
  searchThreshold: number;
  /** The tool set offered now; a tool released mid-turn joins its running list. */
  toolSet: () => ToolSet;
}

/**
 * Which tools wait before they are offered: MCP tools past the threshold and, when the
 * model's window has no room for it, the extended tier of built-ins, both behind
 * `search_tools`; and the task and delegate families until one of them has started.
 */
export class ToolOffer {
  private readonly loaded = new Set<string>();
  private readonly searchingMcp: boolean;
  private extendedHeld = false;
  private familyReleased = false;

  constructor(private readonly options: ToolOfferOptions) {
    const { mcpServers, searchThreshold } = options;
    this.searchingMcp = Boolean(mcpServers && searchThreshold > 0 && mcpServers.size > searchThreshold);
  }

  /** Whether a tool waits behind `search_tools` and has not been loaded. */
  searchable(name: string): boolean {
    const { registry, mcpServers } = this.options;
    if (this.loaded.has(name)) return false;
    if (this.searchingMcp && mcpServers?.has(name)) return true;
    return this.extendedHeld && !mcpServers?.has(name) && registry.get(name)?.tier !== 'core' && name !== 'search_tools';
  }

  /** Whether a tool is kept out of the offer for now. */
  deferred(name: string): boolean {
    return this.searchable(name) || (FAMILY_TOOLS.has(name) && !this.familyReleased);
  }

  /** What `search_tools` can load now. */
  searchList(): { name: string; description: string; server?: string }[] {
    return this.options
      .toolSet()
      .summaries.filter((tool) => this.searchable(tool.name))
      .map((tool) => ({ name: tool.name, description: tool.description, ...(tool.server ? { server: tool.server } : {}) }));
  }

  /** Load what `search_tools` found, offered from the next request of the running turn on. */
  load(names: string[]): void {
    for (const name of names) this.loaded.add(name);
    this.offerNow(names);
  }

  /** After a call: a started task or delegate releases its family, from the next step on. */
  afterCall(name: string): void {
    if (this.familyReleased || (name !== 'task' && name !== 'delegate')) return;
    this.familyReleased = true;
    this.offerNow(
      this.options
        .toolSet()
        .summaries.filter((tool) => FAMILY_TOOLS.has(tool.name))
        .map((tool) => tool.name)
    );
  }

  /**
   * Whether the extended tier fits: the window's budget, less what the prompt and the core
   * tools cost, must leave twice the output reserve. A guessed window never holds it back.
   * Returns whether the decision changed, so the caller rebuilds what depends on it.
   */
  decideTiers(system: string, budget: { budget: number; outputReserve: number }, windowKnown: boolean): boolean {
    const core = this.options.toolSet().definitions.filter((definition) => this.options.registry.get(definition.function.name)?.tier === 'core');
    const base = estimateRequest({ system, tools: core, messages: [] });
    const hold = windowKnown && budget.budget - base < 2 * budget.outputReserve;
    const changed = hold !== this.extendedHeld;
    this.extendedHeld = hold;
    return changed;
  }

  /** Added to the running turn's list too, so the next request carries them. */
  private offerNow(names: string[]): void {
    const toolSet = this.options.toolSet();
    for (const name of names) {
      const tool = toolSet.summaries.find((entry) => entry.name === name);
      if (tool && !toolSet.definitions.some((entry) => entry.function.name === name)) {
        toolSet.definitions.push({ type: 'function', function: { name, description: tool.description, parameters: tool.parameters as Record<string, unknown> } });
      }
    }
  }
}
