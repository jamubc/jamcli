#!/usr/bin/env bun
/**
 * A second, learned approval mode, built beside the trust gate and never in place of it.
 * Everything here is offline and on demand: it reads a person's own session logs, writes
 * files under classifier/data and classifier/models, and changes nothing else.
 *
 *   bun classifier/cli.ts audit   [--dirs a,b] [--surfaces tui,acp,child] [--until date] [--data file] [--json]
 *   bun classifier/cli.ts build   [--dirs a,b] [--surfaces ...] [--out classifier/data/examples.jsonl]
 *   bun classifier/cli.ts eval    [--data file] [--strict] [--budget 0.02]
 *   bun classifier/cli.ts train   [--data file] [--name name] [--budget 0.02]
 *   bun classifier/cli.ts predict --model file --tool run_command --command "git status"
 */
import fs from 'fs';
import path from 'path';
import { audit, formatAudit } from './src/audit.js';
import { adjudicate } from './src/decide.js';
import { evaluate, formatEval, trainCertified } from './src/evaluate.js';
import { extract, historyDirs, type Extraction } from './src/extract.js';
import { explain, type Model } from './src/model.js';
import type { Example } from './src/types.js';

const HERE = import.meta.dir;
const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const load = (): Extraction => {
  const data = flag('data');
  if (data) {
    const examples = fs.readFileSync(data, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Example);
    return { examples, skipped: { nested: 0, unjoined: 0, surface: 0 }, files: new Set(examples.map((example) => example.session)).size };
  }
  const dirs = historyDirs(flag('dirs')?.split(','));
  if (!dirs.length) throw new Error('No session history found. Name folders with --dirs.');
  const until = flag('until') ? Date.parse(flag('until')!) : undefined;
  if (until !== undefined && Number.isNaN(until)) throw new Error('--until needs a date such as 2026-09-28T23:59:59Z.');
  return extract(dirs, { surfaces: flag('surfaces')?.split(','), until });
};

const budget = Number(flag('budget') ?? 0.02);

switch (command) {
  case 'audit': {
    const report = audit(load(), budget);
    console.log(has('json') ? JSON.stringify(report, null, 2) : formatAudit(report));
    break;
  }
  case 'build': {
    const { examples, skipped, files } = load();
    const out = path.resolve(flag('out') ?? path.join(HERE, 'data', 'examples.jsonl'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, examples.map((example) => JSON.stringify(example)).join('\n') + '\n');
    console.log(`${examples.length} examples from ${files} sessions written to ${out} (skipped ${skipped.nested} nested, ${skipped.unjoined} unjoined, ${skipped.surface} on other surfaces).`);
    console.log('This file holds real commands. It is gitignored; keep it that way.');
    break;
  }
  case 'eval': {
    console.log(formatEval(evaluate(load().examples, { strict: has('strict'), budget })));
    break;
  }
  case 'train': {
    const { model, report } = trainCertified(load().examples, { budget });
    const name = flag('name') ?? new Date().toISOString().slice(0, 10);
    const out = path.join(HERE, 'models', `${name}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(model, null, 2)}\n`);
    console.log(formatEval(report));
    const ranked = Object.entries(model.features).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    console.log('', `Model written to ${out}: ${ranked.length} features, lambda ${model.lambda}, authority ${model.authority}${model.threshold !== undefined ? `, threshold ${model.threshold.toFixed(3)}` : ''}.`);
    console.log('Strongest features, for review (positive raises the chance of allow):');
    for (const [feature, weight] of ranked.slice(0, 12)) console.log(`  ${weight >= 0 ? '+' : ''}${weight.toFixed(2)}  ${feature}`);
    break;
  }
  case 'predict': {
    const file = flag('model');
    if (!file) throw new Error('predict needs --model <file>.');
    const model = JSON.parse(fs.readFileSync(file, 'utf8')) as Model;
    const tool = flag('tool') ?? 'run_command';
    const callArgs: Record<string, unknown> = flag('command') ? { command: flag('command') } : flag('path') ? { path: flag('path') } : flag('url') ? { url: flag('url') } : {};
    const query = {
      tool,
      args: callArgs,
      projectRoot: path.resolve(flag('project') ?? process.cwd()),
      mode: flag('mode') ?? 'default',
      surface: flag('surface') ?? 'tui',
      child: false,
      history: { priorHuman: 0, priorAllows: 0, seenAllowed: false, seenDenied: false },
    };
    const result = adjudicate(model, query);
    console.log(`${result.verdict}  p(allow) ${result.p.toFixed(3)}  ${result.reason}`);
    for (const { feature, weight } of explain(model, query)) console.log(`  ${weight >= 0 ? '+' : ''}${weight.toFixed(2)}  ${feature}`);
    break;
  }
  default:
    console.error('Usage: bun classifier/cli.ts audit|build|eval|train|predict [options]. See the header of this file.');
    process.exit(command ? 1 : 2);
}
