import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { z } from 'zod';
import { userConfigDir } from '../../utils/paths.js';
import { parseExpr, templatePaths } from './expr.js';

const ID = /^[a-z0-9][a-z0-9_-]*$/i;

const InputSchema = z.strictObject({
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().optional(),
});

const StepSchema = z
  .strictObject({
    id: z.string().regex(ID, 'must be letters, digits, dashes, and underscores'),
    needs: z.array(z.string()).optional(),
    when: z.string().optional(),
    continue_on_error: z.boolean().optional(),
    agent: z
      .strictObject({
        prompt: z.string().min(1),
        category: z.string().optional(),
        model: z.string().optional(),
        mode: z.enum(['plan', 'default', 'accept-edits', 'auto']).optional(),
        allowed_tools: z.array(z.string()).optional(),
      })
      .optional(),
    run: z.string().min(1).optional(),
    tool: z.strictObject({ name: z.string().min(1), arguments: z.record(z.string(), z.unknown()).default({}) }).optional(),
    approval: z.strictObject({ message: z.string().min(1) }).optional(),
    commit: z.strictObject({ message: z.string().min(1), paths: z.array(z.string()).optional() }).optional(),
    workflow: z.strictObject({ name: z.string().min(1), inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() }).optional(),
  })
  .refine((step) => STEP_KINDS.filter((kind) => step[kind] !== undefined).length === 1, 'must have exactly one of agent, run, tool, approval, commit, or workflow');

export const STEP_KINDS = ['agent', 'run', 'tool', 'approval', 'commit', 'workflow'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

const WorkflowSchema = z.strictObject({
  name: z.string().regex(ID, 'must be letters, digits, dashes, and underscores'),
  description: z.string().optional(),
  inputs: z.record(z.string(), InputSchema).optional(),
  concurrency: z.number().int().min(1).max(4).default(1),
  steps: z.array(StepSchema).min(1),
});

export type Workflow = z.infer<typeof WorkflowSchema> & { file: string };
export type WorkflowStep = Workflow['steps'][number];

export const stepKind = (step: WorkflowStep): StepKind => STEP_KINDS.find((kind) => step[kind] !== undefined)!;

/** The text fields of a step that templates may appear in. */
const templated = (step: WorkflowStep): string[] => [
  step.agent?.prompt,
  step.run,
  step.approval?.message,
  step.commit?.message,
  ...Object.values(step.tool?.arguments ?? {}).filter((value): value is string => typeof value === 'string'),
  ...Object.values(step.workflow?.inputs ?? {}).filter((value): value is string => typeof value === 'string'),
].filter((value): value is string => typeof value === 'string');

/**
 * Check a parsed workflow: step ids are unique, `needs` name earlier-defined steps with no
 * cycle, conditions parse, and templates and conditions name only inputs and steps the
 * step depends on.
 */
export function validateWorkflow(raw: unknown, file: string): Workflow {
  const parsed = WorkflowSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'the file'} ${issue.message}`).join('; ')}`);
  const workflow = { ...parsed.data, file };
  const ids = new Set<string>();
  for (const step of workflow.steps) {
    if (ids.has(step.id)) throw new Error(`${file}: step ${step.id} is defined twice.`);
    ids.add(step.id);
  }
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  for (const step of workflow.steps) {
    for (const need of step.needs ?? []) if (!byId.has(need)) throw new Error(`${file}: step ${step.id} needs ${need}, which is not a step.`);
  }
  // Depth-first search for a cycle, naming it.
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, trail: string[]) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') throw new Error(`${file}: the steps form a cycle: ${[...trail.slice(trail.indexOf(id)), id].join(' -> ')}.`);
    state.set(id, 'visiting');
    for (const need of byId.get(id)!.needs ?? []) visit(need, [...trail, id]);
    state.set(id, 'done');
  };
  for (const step of workflow.steps) visit(step.id, []);

  const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
    for (const need of byId.get(id)!.needs ?? []) if (!seen.has(need)) (seen.add(need), ancestors(need, seen));
    return seen;
  };
  const inputs = new Set(Object.keys(workflow.inputs ?? {}));
  const checkPath = (step: WorkflowStep, dotted: string, where: string) => {
    const [root, name, field] = dotted.split('.');
    if (root === 'inputs' && name && inputs.has(name)) return;
    if (root === 'steps' && name && ancestors(step.id).has(name) && (!field || ['output', 'status'].includes(field))) return;
    throw new Error(`${file}: step ${step.id} ${where} names ${dotted}, which is not an input or the status or output of a step it needs.`);
  };
  for (const step of workflow.steps) {
    if (step.when) {
      let expr;
      try {
        expr = parseExpr(step.when);
      } catch (error: any) {
        throw new Error(`${file}: step ${step.id} has a condition that does not parse: ${error?.message ?? error}.`);
      }
      const paths: string[] = [];
      const collect = (node: any) => {
        if (node.kind === 'path') paths.push(node.path.join('.'));
        if (node.operand) collect(node.operand);
        if (node.left) (collect(node.left), collect(node.right));
      };
      collect(expr);
      for (const dotted of paths) checkPath(step, dotted, 'in its condition');
    }
    for (const text of templated(step)) for (const dotted of templatePaths(text)) checkPath(step, dotted, 'in a template');
  }
  return workflow;
}

export function workflowDirs(projectRoot: string): string[] {
  return [path.join(projectRoot, '.jamcli', 'workflows'), path.join(userConfigDir(), 'workflows')];
}

/** Every workflow file, the project's first; one that does not load is reported and skipped. */
export function loadWorkflows(projectRoot: string): { workflows: Workflow[]; problems: string[] } {
  const byName = new Map<string, Workflow>();
  const problems: string[] = [];
  for (const dir of workflowDirs(projectRoot)) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir).sort()) {
      if (!/\.(ya?ml|json)$/.test(entry)) continue;
      const file = path.join(dir, entry);
      try {
        const text = fs.readFileSync(file, 'utf8');
        const workflow = validateWorkflow(entry.endsWith('.json') ? JSON.parse(text) : YAML.parse(text), file);
        if (!byName.has(workflow.name)) byName.set(workflow.name, workflow);
      } catch (error: any) {
        problems.push(error?.message ?? String(error));
      }
    }
  }
  return { workflows: [...byName.values()], problems };
}

export function findWorkflow(projectRoot: string, name: string): Workflow {
  const { workflows, problems } = loadWorkflows(projectRoot);
  const found = workflows.find((workflow) => workflow.name === name);
  if (found) return found;
  throw new Error(`There is no workflow ${name}.${problems.length ? ` Some files did not load: ${problems.join(' ')}` : ''}`);
}

/** The inputs a run gets: given values, typed, then defaults; a missing required one is an error. */
export function resolveInputs(workflow: Workflow, given: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const inputs: Record<string, string | number | boolean> = {};
  for (const [name, spec] of Object.entries(workflow.inputs ?? {})) {
    const value = given[name] ?? spec.default;
    if (value === undefined) {
      if (spec.required) throw new Error(`Workflow ${workflow.name} needs the input ${name}.`);
      continue;
    }
    if (spec.type === 'number') {
      const number = Number(value);
      if (Number.isNaN(number)) throw new Error(`The input ${name} must be a number.`);
      inputs[name] = number;
    } else if (spec.type === 'boolean') inputs[name] = value === true || value === 'true';
    else inputs[name] = String(value);
  }
  for (const name of Object.keys(given)) if (!(name in (workflow.inputs ?? {}))) throw new Error(`Workflow ${workflow.name} has no input ${name}.`);
  return inputs;
}
