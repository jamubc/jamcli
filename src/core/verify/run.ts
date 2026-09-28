import type { ToolStatus } from '../types.js';
import type { Gate } from './gates.js';
import type { GateRow, GateStatus } from './ledger.js';

/** What a gate run comes to, with its output shaped for the model. */
export interface GateResult extends GateRow {
  /** Under 1,500 characters: the verdict line, the error lines, and the tail. */
  shaped: string;
  /** The full output, for the log. */
  output: string;
}

/** How the harness runs one command: through the same path as a model's call. */
export interface GateRunner {
  (command: string): Promise<{ status: ToolStatus; output: string; durationMs?: number }>;
}

const ERROR_LINE = /error|fail|✗|FAIL|Error:/i;
const SHAPED_LIMIT = 1_500;
const ERROR_LINES = 20;
const TAIL_LINES = 5;

const short = (tree: string | undefined) => (tree ? tree.slice(0, 7) : 'no tree');

/** The model never reads raw gate output: the verdict, the lines that name errors, then the end. */
export function shapeGateOutput(gate: Gate, status: GateStatus, tree: string | undefined, durationMs: number, output: string): string {
  const head = `${gate.name} ${status} in ${Math.round(durationMs / 100) / 10} s on tree ${short(tree)}`;
  if (status === 'passed' || status === 'skipped') return head;
  const lines = output.split('\n').map((line) => line.trimEnd()).filter(Boolean);
  const errors = lines.filter((line) => ERROR_LINE.test(line));
  const shown = errors.slice(0, ERROR_LINES);
  const more = errors.length - shown.length;
  const tail = lines.slice(-TAIL_LINES).filter((line) => !shown.includes(line));
  const text = [head, ...shown, ...(more > 0 ? [`... ${more} more`] : []), ...tail].join('\n');
  return text.length > SHAPED_LIMIT ? `${text.slice(0, SHAPED_LIMIT - 4)}\n...` : text;
}

/** The status a command's status maps to: a refusal is a skip, not a failure. Consent is never overridden. */
export const gateStatusOf = (status: ToolStatus | undefined): GateStatus => (status === 'ok' ? 'passed' : status === 'denied' || status === 'cancelled' ? 'skipped' : 'failed');

/** Run one gate through the consented path and shape what it printed. */
export async function runGate(gate: Gate, deps: { run: GateRunner; tree?: string; step?: number }): Promise<GateResult> {
  const started = Date.now();
  const result = await deps.run(gate.command);
  const durationMs = result.durationMs ?? Date.now() - started;
  const status = gateStatusOf(result.status);
  return {
    ...gate,
    tree: deps.tree,
    step: deps.step,
    status,
    durationMs,
    ts: Date.now(),
    output: result.output,
    shaped: shapeGateOutput(gate, status, deps.tree, durationMs, result.output),
  };
}
