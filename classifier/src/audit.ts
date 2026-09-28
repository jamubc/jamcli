import { certifyN } from './metrics.js';
import { domainOf } from './evaluate.js';
import { isAllow, isHuman, type Example, type LabelKind } from './types.js';
import { fingerprint, type Extraction } from './extract.js';

const count = <T>(items: T[], key: (item: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
};

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export interface AuditReport {
  fingerprint: string;
  files: number;
  approvals: number;
  skipped: Extraction['skipped'];
  decidedBy: Record<string, number>;
  human: number;
  labels: Record<string, number>;
  denyRate: { lenient: number; strict: number };
  projects: Record<string, number>;
  surfaces: Record<string, number>;
  tools: Record<string, number>;
  modes: Record<string, number>;
  days: Record<string, number>;
  distinctCalls: number;
  repeatShare: number;
  floor: { excluded: number; reasons: Record<string, number> };
  domain: { n: number; allows: number; denies: number; strictDenies: number };
  readiness: { budget: number; certifyN: number; deniesWanted: number; humanPerDay: number; deniesPerDay: number; daysToReady?: number };
  warnings: string[];
}

const DENIES_WANTED = 100;

/** What the logs can and cannot support, before any model is trained. */
export function audit(extraction: Extraction, budget = 0.02): AuditReport {
  const { examples } = extraction;
  const human = examples.filter(isHuman);
  const domain = domainOf(examples);
  const strict = domainOf(examples, true);
  const denies = domain.filter((example) => !isAllow(example)).length;
  const stamps = human.map((example) => example.ts);
  const spanDays = stamps.length ? Math.max(1, (Math.max(...stamps) - Math.min(...stamps)) / 86_400_000) : 1;
  const keys = human.map((example) => `${example.tool}:${example.command ?? JSON.stringify(example.args)}`);
  const distinct = new Set(keys).size;
  const projects = count(human, (example) => example.project);
  const top = Math.max(0, ...Object.values(projects));
  const humanPerDay = human.length / spanDays;
  const deniesPerDay = denies / spanDays;
  const need = certifyN(budget);
  const report: AuditReport = {
    fingerprint: fingerprint(examples),
    files: extraction.files,
    approvals: examples.length + extraction.skipped.nested + extraction.skipped.unjoined + extraction.skipped.surface,
    skipped: extraction.skipped,
    decidedBy: count(examples, (example) => example.decidedBy),
    human: human.length,
    labels: count(examples, (example) => example.label),
    denyRate: {
      lenient: domain.length ? denies / domain.length : 0,
      strict: strict.length ? strict.filter((example) => !isAllow(example)).length / strict.length : 0,
    },
    projects,
    surfaces: count(human, (example) => example.surface),
    tools: count(human, (example) => example.tool),
    modes: count(human, (example) => example.mode),
    days: Object.fromEntries(Object.entries(count(human, (example) => day(example.ts))).sort()),
    distinctCalls: distinct,
    repeatShare: human.length ? 1 - distinct / human.length : 0,
    floor: { excluded: human.filter((example) => example.floor).length, reasons: count(human.filter((example) => example.floor), (example) => example.floor!.split(':')[0].replace(/^\S+ /, '').slice(0, 40)) },
    domain: { n: domain.length, allows: domain.length - denies, denies, strictDenies: strict.filter((example) => !isAllow(example)).length },
    readiness: {
      budget,
      certifyN: need,
      deniesWanted: DENIES_WANTED,
      humanPerDay,
      deniesPerDay,
      ...(deniesPerDay > 0 ? { daysToReady: Math.ceil(Math.max((DENIES_WANTED - denies) / deniesPerDay, (need * 2 - domain.length) / Math.max(humanPerDay, 0.01), 0)) } : {}),
    },
    warnings: [],
  };
  const w = report.warnings;
  w.push('Provenance: a decision logged as "user" is any answer nobody labelled otherwise, so a person, an agent answering through the MCP server, and a scripted trial look the same. Every label here is an upper bound on how many are a person.');
  if (denies < 50) w.push(`Only ${denies} denials are in the model's domain. A rare class this small cannot be learned or bounded; a false-allow rate cannot be estimated from it.`);
  if (top / Math.max(human.length, 1) > 0.8) w.push(`One project holds ${Math.round((top / human.length) * 100)}% of the decisions, so a model would learn that project.`);
  if (Object.keys(projects).length < 3) w.push('Fewer than 3 projects: there is no way to test that a model carries from one project to another.');
  if (spanDays < 14) w.push(`The decisions span ${spanDays.toFixed(1)} days: drift over weeks cannot be seen.`);
  const noise = (report.labels.deny_stop ?? 0) + (report.labels.deny_steer ?? 0);
  const allDenies = noise + (report.labels.deny_call ?? 0);
  if (allDenies && noise / allDenies > 0.25) w.push(`${Math.round((noise / allDenies) * 100)}% of denials are a stopped turn or steering typed to the model, which says little about the call.`);
  if (report.repeatShare > 0.2) w.push(`${Math.round(report.repeatShare * 100)}% of decisions repeat an earlier call exactly, so a random split would overstate skill; splits are by session.`);
  return report;
}

const table = (record: Record<string, number>, total: number) =>
  Object.entries(record)
    .map(([key, value]) => `${key} ${value} (${Math.round((value / Math.max(total, 1)) * 100)}%)`)
    .join(', ');

export function formatAudit(report: AuditReport): string {
  const r = report;
  const labels: LabelKind[] = ['allow', 'allow_grant', 'deny_call', 'deny_steer', 'deny_stop', 'system'];
  return [
    'Data audit',
    `  fingerprint ${r.fingerprint}`,
    `  ${r.files} session files, ${r.approvals} approval events; skipped ${r.skipped.nested} nested, ${r.skipped.unjoined} unjoined, ${r.skipped.surface} on other surfaces`,
    `  answered by: ${table(r.decidedBy, r.approvals - r.skipped.nested - r.skipped.unjoined - r.skipped.surface)}`,
    `  labels: ${labels.map((label) => `${label} ${r.labels[label] ?? 0}`).join(', ')}`,
    `  human decisions ${r.human}; in the model's domain ${r.domain.n} (${r.domain.allows} allowed, ${r.domain.denies} denied, ${r.domain.strictDenies} of them about the call); ${r.floor.excluded} more beyond the safety floor`,
    `  denial rate: ${(r.denyRate.lenient * 100).toFixed(1)}% counting every denial, ${(r.denyRate.strict * 100).toFixed(1)}% counting only those about the call`,
    `  projects: ${table(r.projects, r.human)}`,
    `  surfaces: ${table(r.surfaces, r.human)}`,
    `  tools: ${table(r.tools, r.human)}`,
    `  modes: ${table(r.modes, r.human)}`,
    `  days: ${Object.entries(r.days).map(([d, n]) => `${d} ${n}`).join(', ')}`,
    `  ${r.distinctCalls} distinct calls; ${(r.repeatShare * 100).toFixed(0)}% repeat an earlier one`,
    '',
    'Readiness',
    `  To certify a ${(r.readiness.budget * 100).toFixed(1)}% false-allow budget the data must hold about ${r.readiness.certifyN} auto-allowed decisions with none wrong; a stable rare class wants about ${r.readiness.deniesWanted} denials.`,
    `  At ${r.readiness.humanPerDay.toFixed(1)} decisions and ${r.readiness.deniesPerDay.toFixed(2)} denials a day: ${r.readiness.daysToReady === undefined ? 'no denials yet' : `about ${r.readiness.daysToReady} more days at this rate`}.`,
    '',
    'Warnings',
    ...r.warnings.map((warning) => `  - ${warning}`),
  ].join('\n');
}

export type { Example };
