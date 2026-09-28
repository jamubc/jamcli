import { featurize } from './features.js';
import { averagePrecision, ece, gate, logLoss, operatingCurve, policyRow, rocAuc, type CurvePoint, type GateReport, type PolicyRow } from './metrics.js';
import { familiar, fitBest, score, type Model } from './model.js';
import { groupKFold, temporalSplit } from './split.js';
import { LABEL_WEIGHT, isHuman, target, type Example } from './types.js';

/** Fewer denials than this and an AUC is noise, so none is reported. */
const MIN_DENIES_FOR_AUC = 5;

export interface EvalOptions {
  /** Leave out denials that are not about the call: a stopped turn, or steering typed to the model. */
  strict?: boolean;
  budget?: number;
  confidence?: number;
  folds?: number;
}

/** The calls a model may weigh: a person's answer, and nothing the safety floor keeps from it. */
export function domainOf(examples: Example[], strict = false): Example[] {
  return examples.filter((example) => isHuman(example) && !example.floor && (!strict || (example.label !== 'deny_stop' && example.label !== 'deny_steer')));
}

/** Each example scored by a model that never saw its session, keyed by example id. */
export function outOfFold(data: Example[], folds = 5): { scores: Map<string, number>; known: Map<string, boolean>; foldAucs: number[] } {
  const scores = new Map<string, number>();
  const known = new Map<string, boolean>();
  const foldAucs: number[] = [];
  const parts = groupKFold(data, Math.max(2, Math.min(folds, new Set(data.map((example) => example.session)).size)));
  parts.forEach((test, i) => {
    const fit = fitBest(parts.flatMap((part, j) => (j === i ? [] : part)));
    const own = test.map((example) => score(fit, example));
    test.forEach((example, k) => {
      scores.set(example.id, own[k]);
      known.set(example.id, familiar(fit, example));
    });
    const auc = rocAuc(own, test.map((example) => target(example) === 1));
    if (auc !== undefined) foldAucs.push(auc);
  });
  return { scores, known, foldAucs };
}

export interface EvalReport {
  strict: boolean;
  n: number;
  allows: number;
  denies: number;
  sessions: number;
  excluded: { floor: number; system: number; droppedDenials: number };
  baselines: PolicyRow[];
  model: {
    auc?: number;
    /** The mean of each fold's own AUC. Pooled scores come from different models, so this is the safer number. */
    macroAuc?: number;
    denyAP?: number;
    denyPrevalence: number;
    logLoss: number;
    priorLogLoss: number;
    ece: number;
    /** The largest prefix of the ranking that contains no denial: what was observed, not what is certified. */
    zeroFalseAllow?: CurvePoint;
    gate: GateReport;
  };
  temporal?: { n: number; denies: number; auc?: number; threshold?: number; policy?: PolicyRow; note: string };
}

export function evaluate(examples: Example[], options: EvalOptions = {}): EvalReport {
  const strict = options.strict ?? false;
  const data = domainOf(examples, strict);
  const deny = data.map((example) => target(example) === 0);
  const y = data.map(target);
  const denies = deny.filter(Boolean).length;
  const human = examples.filter(isHuman);
  const excluded = {
    floor: human.filter((example) => example.floor).length,
    system: examples.length - human.length,
    droppedDenials: strict ? human.filter((example) => !example.floor && (example.label === 'deny_stop' || example.label === 'deny_steer')).length : 0,
  };
  const report: EvalReport = {
    strict,
    n: data.length,
    allows: data.length - denies,
    denies,
    sessions: new Set(data.map((example) => example.session)).size,
    excluded,
    baselines: [],
    model: { denyPrevalence: data.length ? denies / data.length : 0, logLoss: 0, priorLogLoss: 0, ece: 0, gate: gate([], options.budget, options.confidence) },
  };
  if (data.length < 10) return report;

  report.baselines = [
    policyRow('allow everything', data.map(() => true), deny),
    policyRow('read-only commands (M2)', data.map((example) => featurize(example).includes('readonly')), deny),
    policyRow('same call allowed before', data.map((example) => example.history.seenAllowed && !example.history.seenDenied), deny),
  ];

  const oof = outOfFold(data, options.folds ?? 5);
  const p = data.map((example) => oof.scores.get(example.id) ?? 0.5);
  const weights = data.map((example) => (example.label === 'system' ? 0 : LABEL_WEIGHT[example.label]));
  const prior = weights.reduce((sum, w, i) => sum + w * y[i], 0) / (weights.reduce((sum, w) => sum + w, 0) || 1);
  // A call the fold's model had no evidence about is never auto-allowed, whatever its score.
  const curve = operatingCurve(p.map((value, i) => ({ p: oof.known.get(data[i].id) ? value : -1, deny: deny[i] })));
  const certified = gate(curve, options.budget, options.confidence);
  report.model = {
    auc: rocAuc(p, y.map((value) => value === 1)),
    ...(oof.foldAucs.length ? { macroAuc: oof.foldAucs.reduce((sum, value) => sum + value, 0) / oof.foldAucs.length } : {}),
    denyAP: averagePrecision(p.map((value) => 1 - value), deny),
    denyPrevalence: denies / data.length,
    logLoss: logLoss(p, y, weights),
    priorLogLoss: logLoss(p.map(() => prior), y, weights),
    ece: ece(p, y),
    zeroFalseAllow: [...curve].filter((point) => point.falseAllows === 0).sort((a, b) => b.k - a.k)[0],
    gate: certified,
  };

  // A model fit on the past, judged on the sessions that came after, at the threshold the out-of-fold ranking chose.
  const { train: past, test: later } = temporalSplit(data);
  if (past.length >= 10 && later.length >= 5) {
    const fit = fitBest(past);
    const scores = later.map((example) => (familiar(fit, example) ? score(fit, example) : -1));
    const laterDeny = later.map((example) => target(example) === 0);
    const threshold = certified.best?.threshold ?? report.model.zeroFalseAllow?.threshold;
    report.temporal = {
      n: later.length,
      denies: laterDeny.filter(Boolean).length,
      ...(laterDeny.filter(Boolean).length >= MIN_DENIES_FOR_AUC ? { auc: rocAuc(scores, laterDeny.map((value) => !value)) } : {}),
      ...(threshold !== undefined ? { threshold, policy: policyRow('model at that threshold', scores.map((value) => value >= threshold), laterDeny) } : {}),
      note: 'trained on earlier sessions, scored on later ones',
    };
  }
  return report;
}

/** Fit on every domain example, and let the out-of-fold gate say how much authority the result may have. */
export function trainCertified(examples: Example[], options: EvalOptions = {}): { model: Model; report: EvalReport } {
  const data = domainOf(examples, false);
  const report = evaluate(examples, { ...options, strict: false });
  const model = fitBest(data);
  const best = report.model.gate.best;
  return {
    report,
    model: { ...model, gate: report.model.gate, authority: report.model.gate.passed && best ? 'assist' : 'none', ...(best && report.model.gate.passed ? { threshold: best.threshold } : {}) },
  };
}

const pct = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`;
const num = (value: number | undefined, digits = 3) => (value === undefined ? 'n/a' : value.toFixed(digits));

const row = (policy: PolicyRow) =>
  `  ${policy.name.padEnd(28)} allows ${String(policy.k).padStart(4)} (saves ${pct(policy.coverage).padStart(4)})  false allows ${String(policy.falseAllows).padStart(3)}  rate ${pct(policy.far, 1).padStart(6)}  upper bound ${pct(policy.farUpper, 1).padStart(6)}`;

export function formatEval(report: EvalReport): string {
  const lines = [
    `Evaluation (${report.strict ? 'strict: denials about the call only' : 'lenient: every denial counts'})`,
    `  examples ${report.n} from ${report.sessions} sessions: ${report.allows} allowed, ${report.denies} denied (${pct(report.model.denyPrevalence, 1)})`,
    `  left out: ${report.excluded.floor} beyond the safety floor, ${report.excluded.system} answered by no person${report.strict ? `, ${report.excluded.droppedDenials} denials not about the call` : ''}`,
  ];
  if (!report.baselines.length) return [...lines, '', '  Too few examples to evaluate. Collect more decisions first.'].join('\n');
  lines.push('', 'Policies that would auto-allow some asked calls, against what the person answered:', ...report.baselines.map(row));
  const m = report.model;
  lines.push(
    '',
    `Model, scored by sessions it never saw (5-fold out of fold):`,
    `  ROC AUC ${num(m.macroAuc)} averaged over folds (${num(m.auc)} pooled; 0.5 is chance)   deny average precision ${num(m.denyAP)} against a prevalence of ${num(m.denyPrevalence)}`,
    `  log loss ${num(m.logLoss)} against ${num(m.priorLogLoss)} for the prior alone   calibration error ${num(m.ece)}`
  );
  if (m.zeroFalseAllow) lines.push(`  observed: the top ${m.zeroFalseAllow.k} calls (${pct(m.zeroFalseAllow.coverage)}) contain no denial, upper bound ${pct(m.zeroFalseAllow.farUpper, 1)}`);
  lines.push('', `Gate at ${pct(m.gate.budget, 1)} false-allow budget, ${pct(m.gate.confidence)} confidence: ${m.gate.passed ? 'PASSED' : 'NOT PASSED'}`, `  ${m.gate.reason}`);
  if (report.temporal) {
    const t = report.temporal;
    lines.push('', `Temporal check (${t.note}): ${t.n} calls, ${t.denies} denied${t.auc === undefined ? `, too few denials for an AUC (under ${MIN_DENIES_FOR_AUC})` : `, ROC AUC ${num(t.auc)}`}`);
    if (t.policy) lines.push(row(t.policy));
    else lines.push('  no threshold to apply');
  }
  return lines.join('\n');
}
