import { hardFloor } from './floor.js';
import type { Query } from './features.js';
import { familiar, score, type Model } from './model.js';

export interface Adjudication {
  /** The classifier can save a prompt; it cannot deny, and it cannot answer for a call it is unsure of. */
  verdict: 'allow' | 'abstain';
  p: number;
  reason: string;
}

/**
 * The whole contract between this folder and a runtime: given a call the engine would
 * ask about, allow it without asking or abstain, so the person is asked. Nothing here
 * grants more than the model's gate certified, and nothing overrides the safety floor.
 */
export function adjudicate(model: Model, query: Query): Adjudication {
  const p = score(model, query);
  const floor = hardFloor(query.tool, query.args, query.projectRoot);
  if (floor) return { verdict: 'abstain', p, reason: `beyond any model's authority: ${floor}` };
  if (model.authority !== 'assist' || model.threshold === undefined) return { verdict: 'abstain', p, reason: 'shadow only: no gate has certified this model' };
  if (!familiar(model, query)) return { verdict: 'abstain', p, reason: 'unfamiliar: the model has no evidence about part of this call' };
  if (p >= model.threshold) return { verdict: 'allow', p, reason: `p ${p.toFixed(3)} is at or above the certified ${model.threshold.toFixed(3)}` };
  return { verdict: 'abstain', p, reason: `p ${p.toFixed(3)} is below the certified ${model.threshold.toFixed(3)}` };
}
