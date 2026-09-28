/** One-sided Wilson upper bound on a rate: k events in n trials, z = 1.645 for 95 percent. */
export function wilsonUpper(k: number, n: number, z = 1.645): number {
  if (n === 0) return 1;
  const p = k / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.min(1, (centre + margin) / (1 + z2 / n));
}

/** Auto-allowed decisions with no false allow needed before the upper bound falls under `budget` (the rule of three, exact form). */
export const certifyN = (budget: number, confidence = 0.95): number => Math.ceil(Math.log(1 - confidence) / Math.log(1 - budget));

/** Area under the ROC curve for scoring `positive` cases above the rest, ties counted half. Undefined without both kinds. */
export function rocAuc(scores: number[], positive: boolean[]): number | undefined {
  const pos = positive.filter(Boolean).length;
  const neg = positive.length - pos;
  if (!pos || !neg) return undefined;
  const order = scores.map((score, index) => ({ score, index })).sort((a, b) => a.score - b.score);
  let rankSum = 0;
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].score === order[i].score) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let m = i; m <= j; m += 1) if (positive[order[m].index]) rankSum += rank;
    i = j + 1;
  }
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Average precision for finding `positive` cases by high score: the area a rare class cares about. */
export function averagePrecision(scores: number[], positive: boolean[]): number | undefined {
  const pos = positive.filter(Boolean).length;
  if (!pos) return undefined;
  const order = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score || a.index - b.index);
  let hits = 0;
  let sum = 0;
  order.forEach(({ index }, rank) => {
    if (!positive[index]) return;
    hits += 1;
    sum += hits / (rank + 1);
  });
  return sum / pos;
}

export function logLoss(p: number[], y: number[], weights?: number[]): number {
  const eps = 1e-9;
  let total = 0;
  let sum = 0;
  p.forEach((value, i) => {
    const w = weights?.[i] ?? 1;
    const clipped = Math.min(1 - eps, Math.max(eps, value));
    total += w * -(y[i] * Math.log(clipped) + (1 - y[i]) * Math.log(1 - clipped));
    sum += w;
  });
  return sum ? total / sum : 0;
}

/** Expected calibration error over equal-width bins. */
export function ece(p: number[], y: number[], bins = 10): number {
  let error = 0;
  for (let b = 0; b < bins; b += 1) {
    const members = p.map((value, i) => ({ value, y: y[i] })).filter(({ value }) => (b === bins - 1 ? value >= b / bins : value >= b / bins && value < (b + 1) / bins));
    if (!members.length) continue;
    const confidence = members.reduce((sum, m) => sum + m.value, 0) / members.length;
    const accuracy = members.reduce((sum, m) => sum + m.y, 0) / members.length;
    error += (members.length / p.length) * Math.abs(confidence - accuracy);
  }
  return error;
}

export interface PolicyRow {
  name: string;
  /** Calls the policy would have allowed without asking. */
  k: number;
  /** Share of asked calls that is: the prompts saved. */
  coverage: number;
  /** Of those, calls the person did not allow. */
  falseAllows: number;
  far: number;
  farUpper: number;
}

/** What a policy that auto-allows some asked calls would have done, against what the person answered. */
export function policyRow(name: string, allowed: boolean[], deny: boolean[]): PolicyRow {
  const k = allowed.filter(Boolean).length;
  const falseAllows = allowed.filter((value, i) => value && deny[i]).length;
  return { name, k, coverage: allowed.length ? k / allowed.length : 0, falseAllows, far: k ? falseAllows / k : 0, farUpper: wilsonUpper(falseAllows, k) };
}

export interface CurvePoint {
  threshold: number;
  k: number;
  coverage: number;
  falseAllows: number;
  far: number;
  farUpper: number;
}

/** Auto-allowing every call scored at or above each distinct threshold, highest first. */
export function operatingCurve(items: { p: number; deny: boolean }[]): CurvePoint[] {
  const sorted = [...items].sort((a, b) => b.p - a.p);
  const points: CurvePoint[] = [];
  let falseAllows = 0;
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].p === sorted[i].p) j += 1;
    for (let m = i; m <= j; m += 1) if (sorted[m].deny) falseAllows += 1;
    const k = j + 1;
    if (sorted[i].p < 0) break;
    points.push({ threshold: sorted[i].p, k, coverage: k / sorted.length, falseAllows, far: falseAllows / k, farUpper: wilsonUpper(falseAllows, k) });
    i = j + 1;
  }
  return points;
}

export interface GateReport {
  budget: number;
  confidence: number;
  /** The most prompts a threshold saves while its false-allow upper bound stays within budget. */
  best?: CurvePoint;
  /** Auto-allowed decisions with no false allow that would certify the budget outright. */
  certifyN: number;
  passed: boolean;
  reason: string;
}

/** The promotion gate: a threshold is certified only when the data bounds its false-allow rate, not merely observes it low. */
export function gate(curve: CurvePoint[], budget = 0.02, confidence = 0.95): GateReport {
  const z = confidence === 0.95 ? 1.645 : confidence === 0.99 ? 2.326 : 1.645;
  const fit = curve.filter((point) => wilsonUpper(point.falseAllows, point.k, z) <= budget);
  const best = fit.sort((a, b) => b.k - a.k)[0];
  const need = certifyN(budget, confidence);
  return best
    ? { budget, confidence, best, certifyN: need, passed: true, reason: `threshold ${best.threshold.toFixed(3)} saves ${(best.coverage * 100).toFixed(0)}% of prompts with a false-allow rate bounded under ${(budget * 100).toFixed(1)}%` }
    : { budget, confidence, certifyN: need, passed: false, reason: `no threshold has a false-allow rate the data bounds under ${(budget * 100).toFixed(1)}% at ${(confidence * 100).toFixed(0)}% confidence; that needs about ${need} auto-allowed decisions with no false allow` };
}
