import type { HookBus, HookVerdict } from '../hooks/index.js';

type Verdict = Partial<HookVerdict>;
import type { AgentEvent } from '../types.js';
import type { TodoItem } from '../tools/todo.js';
import type { Gate } from './gates.js';
import type { Ledger, GateRow } from './ledger.js';
import type { GateResult } from './run.js';

/** How long a gate may have taken last time before it is left for the stop instead of run after every edit. */
export const AFTER_EDIT_BOUND_MS = 60_000;
/** How many times a turn's stop may be denied before it is allowed with a warning. */
export const MAX_STOP_DENIALS = 2;

export interface VerifyDeps {
  gates: Gate[];
  ledger: Ledger;
  /** The working copy the last changing step left, as its checkpoint keyed it. */
  currentTree: () => string | undefined;
  changedThisTurn: () => boolean;
  step: () => number;
  run: (gate: Gate) => Promise<GateResult>;
  emit: (event: AgentEvent) => void;
  todos?: {
    read: () => Promise<TodoItem[]>;
    stamp: (stamp: { gate: string; tree: string }) => Promise<void>;
  };
  /** Whether a stop may be denied. Off for a child: its parent's stop covers the tree. */
  backpressure: boolean;
  maxStopDenials?: number;
  afterEditBoundMs?: number;
  /** The tiers a stop runs, in order. */
  stopTiers?: ('T1' | 'T2')[];
}

const gateEvent = (row: GateRow & { shaped?: string }): AgentEvent => ({
  type: 'gate',
  tier: row.tier,
  name: row.name,
  command: row.command,
  ...(row.tree ? { tree: row.tree } : {}),
  status: row.status,
  durationMs: row.durationMs,
  ...(row.step ? { step: row.step } : {}),
  ...(row.byModel ? { byModel: true } : {}),
  shaped: row.shaped ?? '',
});

const normalizeCommand = (text: unknown) => (typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '');

/**
 * The two verification handlers, M4 and M5, on the in-process bus. After a step that
 * changed files, the first static gate runs on the tree it left. At a stop with changes,
 * whatever has not passed on that tree runs, and a failure sends the model back to it.
 * Every run goes through the permission engine, so a person's no is a skip, never a fail.
 */
export function registerVerifyMiddleware(bus: HookBus, deps: VerifyDeps): { record: (row: GateRow) => void } {
  let denials = 0;
  bus.on(
    'turn_start',
    () => {
      denials = 0;
    },
    'verify turn',
    { internal: true }
  );

  const record = (row: GateResult | GateRow) => {
    deps.ledger.record(row);
    deps.emit(gateEvent(row));
  };

  bus.on(
    'post_tool',
    async ({ call, result }): Promise<Verdict | undefined> => {
      const tree = deps.currentTree();
      // The model ran a gate itself: its result is a row, so the harness does not run it again.
      if (call.name === 'run_command' && tree) {
        const command = normalizeCommand(call.arguments?.command);
        const gate = deps.gates.find((candidate) => normalizeCommand(candidate.command) === command);
        if (gate) {
          record({ ...gate, tree, step: deps.step(), status: result.status === 'ok' ? 'passed' : result.status === 'denied' || result.status === 'cancelled' ? 'skipped' : 'failed', durationMs: result.durationMs, byModel: true, ts: Date.now() });
          return undefined;
        }
      }
      if (!tree || !deps.changedThisTurn()) return undefined;
      if (!['edit', 'write_file', 'apply_patch'].includes(call.name) || !result.success) return undefined;
      // A language server's verdict on the edited file, recorded by its own hook ahead of this one, stands in for the static gate this step.
      if (deps.ledger.has(tree, 'T0') || deps.ledger.has(tree, 'T1')) return undefined;
      const t1 = deps.gates.find((gate) => gate.tier === 'T1');
      if (!t1) return undefined;
      const last = deps.ledger.lastDuration(t1.name);
      if (last !== undefined && last > (deps.afterEditBoundMs ?? AFTER_EDIT_BOUND_MS)) {
        record({ ...t1, tree, step: deps.step(), status: 'skipped', durationMs: 0, ts: Date.now() });
        return undefined;
      }
      const run = await deps.run(t1);
      record(run);
      return run.status === 'failed' ? { context: [`[Gate ${run.name} failed on your last edits:\n${run.shaped}]`] } : undefined;
    },
    'M4 gate after edit',
    { internal: true }
  );

  bus.on(
    'stop',
    async (): Promise<Verdict | undefined> => {
      if (!deps.backpressure || !deps.changedThisTurn()) return undefined;
      const tree = deps.currentTree();
      if (!tree) return undefined;
      const ran: string[] = [];
      for (const tier of deps.stopTiers ?? (['T1', 'T2'] as const)) {
        const gate = deps.gates.find((candidate) => candidate.tier === tier);
        if (!gate) continue;
        if (deps.ledger.passed(tree, tier)) {
          ran.push(gate.name);
          continue;
        }
        const run = await deps.run(gate);
        record(run);
        if (run.status === 'skipped') continue;
        ran.push(gate.name);
        if (run.status !== 'failed') continue;
        if (denials < (deps.maxStopDenials ?? MAX_STOP_DENIALS)) {
          denials += 1;
          deps.emit({ type: 'steer', handler: 'M5', detail: `stop denied: ${gate.name} failed on tree ${tree.slice(0, 7)}` });
          return { decision: 'deny', reason: `${run.shaped}\nFix what the gate reports before saying anything is done.` };
        }
        deps.emit({ type: 'notice', level: 'warn', code: 'gate_failed', message: `The turn ended with ${gate.name} failing; see the result above.` });
        return undefined;
      }
      if (deps.todos && ran.length) await deps.todos.stamp({ gate: ran.join(', '), tree }).catch(() => undefined);
      return undefined;
    },
    'M5 backpressure',
    { internal: true }
  );
  return { record };
}
