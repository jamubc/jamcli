import type { HookBus, HookVerdict } from '../hooks/index.js';
import { analyzeCommand } from '../permissions/command.js';
import { readOnlyReason } from '../tools/readonly.js';
import type { AgentEvent, ToolCall } from '../types.js';

type Verdict = Partial<HookVerdict>;

/** Tools whose result depends only on the working copy, so a repeat on the same tree is the same result. */
const TREE_READS = new Set(['read_file', 'grep', 'glob', 'list_files', 'search_code']);

export interface SteerDeps {
  projectRoot: string;
  /** Whether the engine, left alone, would ask the person about this call because of the mode. */
  modeWouldAsk: (call: ToolCall) => boolean;
  /** The working copy the last changing step left. */
  currentTree: () => string | undefined;
  emit: (event: AgentEvent) => void;
  /** Programs M2 treats as read-only, in place of the built-in list. */
  readOnlyCommands?: Set<string>;
}

const keyOf = (call: ToolCall) => `${call.name}\u0000${JSON.stringify(call.arguments ?? {})}`;

/**
 * The two steering handlers on the pre_tool bus. M2 answers what default mode would ask
 * about a command that only reads inside the project, so the person is not asked to
 * approve `ls`. M3 refuses a read repeated with the same arguments on the same tree, with
 * the earlier result's first line, so a model does not pay twice for one file.
 */
export function registerSteerMiddleware(bus: HookBus, deps: SteerDeps): void {
  const answered = new Map<string, { firstLine: string; tree: string | undefined }>();
  bus.on('turn_start', () => answered.clear(), 'steer turn', { internal: true });

  bus.on(
    'pre_tool',
    ({ call }): Verdict | undefined => {
      if (call.name !== 'run_command' || typeof call.arguments?.command !== 'string') return undefined;
      const analysis = analyzeCommand(call.arguments.command);
      if (readOnlyReason(analysis, deps.projectRoot, deps.readOnlyCommands) !== undefined) return undefined;
      if (!deps.modeWouldAsk(call)) return undefined;
      deps.emit({ type: 'steer', handler: 'M2', callId: call.id, detail: `allowed a read-only command: ${analysis.parts.join(' | ')}` });
      return { decision: 'allow', reason: 'it only reads inside the project' };
    },
    'M2 read-only commands',
    { internal: true }
  );

  bus.on(
    'pre_tool',
    ({ call }): Verdict | undefined => {
      if (!TREE_READS.has(call.name)) return undefined;
      const known = answered.get(keyOf(call));
      if (!known || known.tree !== deps.currentTree()) return undefined;
      deps.emit({ type: 'steer', handler: 'M3', callId: call.id, detail: `refused a repeated ${call.name} on the same tree` });
      return { block: `same call, same result; nothing has changed since. It began: ${known.firstLine}` };
    },
    'M3 repeated reads',
    { internal: true }
  );

  bus.on(
    'post_tool',
    ({ call, result, output }) => {
      if (!TREE_READS.has(call.name) || !result.success) return undefined;
      answered.set(keyOf(call), { firstLine: output.split('\n')[0]?.slice(0, 160) ?? '', tree: deps.currentTree() });
      return undefined;
    },
    'M3 remember reads',
    { internal: true }
  );
}
