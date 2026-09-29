import type { HookBus, HookVerdict } from '../hooks/index.js';
import { analyzeCommand } from '../permissions/command.js';
import { readOnlyReason } from '../tools/readonly.js';
import type { AgentEvent, ToolCall } from '../types.js';

type Verdict = Partial<HookVerdict>;

export interface SteerDeps {
  projectRoot: string;
  /** Whether the engine, left alone, would ask the person about this call because of the mode. */
  modeWouldAsk: (call: ToolCall) => boolean;
  emit: (event: AgentEvent) => void;
}

/**
 * The steering handler on the pre_tool bus. M2 answers what default mode would ask about a
 * command that only reads inside the project, so the person is not asked to approve `ls`.
 */
export function registerSteerMiddleware(bus: HookBus, deps: SteerDeps): void {
  bus.on(
    'pre_tool',
    ({ call }): Verdict | undefined => {
      if (call.name !== 'run_command' || typeof call.arguments?.command !== 'string') return undefined;
      const analysis = analyzeCommand(call.arguments.command);
      if (readOnlyReason(analysis, deps.projectRoot) !== undefined) return undefined;
      if (!deps.modeWouldAsk(call)) return undefined;
      deps.emit({ type: 'steer', handler: 'M2', callId: call.id, detail: `allowed a read-only command: ${analysis.parts.join(' | ')}` });
      return { decision: 'allow', reason: 'it only reads inside the project' };
    },
    'M2 read-only commands',
    { internal: true }
  );
}
