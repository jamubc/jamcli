import { featurize, identityOf, type Query } from './features.js';
import { logLoss, type GateReport } from './metrics.js';
import { groupKFold } from './split.js';
import { LABEL_WEIGHT, isHuman, target, type Example } from './types.js';

/** A reviewable model: every weight is a named feature a person can read. */
export interface Model {
  version: 1;
  kind: 'logreg';
  features: Record<string, number>;
  /** Programs, hosts, agents, and file types the person decided on at least `minCount` times: what the model has evidence about. */
  known: string[];
  bias: number;
  lambda: number;
  trainedOn: { n: number; allows: number; denies: number; from: number; to: number; projects: string[] };
  /** `none` until a gate has certified a threshold; the runtime may not grant more than this says. */
  authority: 'none' | 'assist';
  threshold?: number;
  gate?: GateReport;
  createdAt: number;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const weightOf = (example: Example) => (example.label === 'system' ? 0 : LABEL_WEIGHT[example.label]);

export interface TrainOptions {
  lambda?: number;
  minCount?: number;
  iterations?: number;
  rate?: number;
}

/** L2-regularized logistic regression by full-batch gradient descent: deterministic, and quick at this scale. */
export function train(examples: Example[], options: TrainOptions = {}): Model {
  const data = examples.filter(isHuman);
  const lambda = options.lambda ?? 0.01;
  const minCount = options.minCount ?? 2;
  const rows = data.map((example) => featurize(example));
  const counts = new Map<string, number>();
  for (const row of rows) for (const name of row) counts.set(name, (counts.get(name) ?? 0) + 1);
  const names = [...counts].filter(([, count]) => count >= minCount).map(([name]) => name).sort();
  const known = identityOf(names);
  const index = new Map(names.map((name, i) => [name, i]));
  const x = rows.map((row) => row.flatMap((name) => (index.has(name) ? [index.get(name)!] : [])));
  const y = data.map(target);
  const w = data.map(weightOf);
  const total = w.reduce((sum, value) => sum + value, 0) || 1;
  const prior = Math.min(0.999, Math.max(0.001, w.reduce((sum, value, i) => sum + value * y[i], 0) / total));
  let bias = Math.log(prior / (1 - prior));
  const weights = new Float64Array(names.length);
  const rate = options.rate ?? 0.15;
  for (let step = 0; step < (options.iterations ?? 500); step += 1) {
    const gradient = new Float64Array(names.length);
    let gradientBias = 0;
    for (let i = 0; i < x.length; i += 1) {
      let z = bias;
      for (const j of x[i]) z += weights[j];
      const error = (w[i] * (sigmoid(z) - y[i])) / total;
      gradientBias += error;
      for (const j of x[i]) gradient[j] += error;
    }
    for (let j = 0; j < names.length; j += 1) weights[j] -= rate * (gradient[j] + lambda * weights[j]);
    bias -= rate * gradientBias;
  }
  const features: Record<string, number> = {};
  names.forEach((name, i) => {
    if (Math.abs(weights[i]) > 1e-6) features[name] = Number(weights[i].toFixed(5));
  });
  const stamps = data.map((example) => example.ts);
  return {
    version: 1,
    kind: 'logreg',
    features,
    known,
    bias: Number(bias.toFixed(5)),
    lambda,
    trainedOn: {
      n: data.length,
      allows: data.filter((example) => target(example) === 1).length,
      denies: data.filter((example) => target(example) === 0).length,
      from: stamps.length ? Math.min(...stamps) : 0,
      to: stamps.length ? Math.max(...stamps) : 0,
      projects: [...new Set(data.map((example) => example.project))].sort(),
    },
    authority: 'none',
    createdAt: Date.now(),
  };
}

/** The probability the person would allow this call. */
export function score(model: Model, query: Query): number {
  let z = model.bias;
  for (const name of featurize(query)) z += model.features[name] ?? 0;
  return sigmoid(z);
}

/**
 * Whether the model has evidence about this call: every program, host, agent, and file
 * type in it was decided on before. A call it has never seen scores near the base rate,
 * which is high, so without this check ignorance would read as permission.
 */
export function familiar(model: Model, query: Query): boolean {
  const identity = identityOf(featurize(query));
  const known = new Set(model.known ?? []);
  return identity.length > 0 && identity.every((name) => known.has(name));
}

/** The features that moved a score most, with their weights. */
export function explain(model: Model, query: Query, top = 8): { feature: string; weight: number }[] {
  return featurize(query)
    .flatMap((feature) => (feature in model.features ? [{ feature, weight: model.features[feature] }] : []))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, top);
}

export const LAMBDAS = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3];

/** The regularization that generalizes best across held-out sessions, then a model fit on everything it was given. */
export function fitBest(examples: Example[], options: TrainOptions & { lambdas?: number[]; folds?: number } = {}): Model {
  const data = examples.filter(isHuman);
  const lambdas = options.lambdas ?? LAMBDAS;
  const folds = Math.min(options.folds ?? 3, new Set(data.map((example) => example.session)).size);
  if (folds < 2 || data.length < 10) return train(data, { ...options, lambda: options.lambda ?? 0.1 });
  const split = groupKFold(data, folds);
  let best = lambdas[0];
  let bestLoss = Infinity;
  for (const lambda of lambdas) {
    const p: number[] = [];
    const y: number[] = [];
    const w: number[] = [];
    split.forEach((test, i) => {
      const fit = train(split.flatMap((fold, j) => (j === i ? [] : fold)), { ...options, lambda });
      for (const example of test) {
        p.push(score(fit, example));
        y.push(target(example));
        w.push(weightOf(example));
      }
    });
    const loss = logLoss(p, y, w);
    if (loss < bestLoss) {
      bestLoss = loss;
      best = lambda;
    }
  }
  return train(data, { ...options, lambda: best });
}
