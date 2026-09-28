import fs from 'fs';
import path from 'path';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import type { ElicitationRequest } from '../mcp/connect.js';
import { ensureProjectStateDir } from '../transcript/log.js';
import { formatTodos, readTodos } from './todo.js';

const JAMCLI_DIR = '.jamcli';
export const PLAN_FILE = 'plan.md';
/** Characters the pinned state may take in a summary. */
const PINNED_BUDGET = 4_000;

/** The project's plan file: the one thing the model writes in plan mode, which the person may edit by hand. */
export const planFile = (projectRoot: string): string => path.join(projectRoot, JAMCLI_DIR, PLAN_FILE);

const readPlan = (projectRoot: string): string | undefined => {
  try {
    return fs.readFileSync(planFile(projectRoot), 'utf8');
  } catch {
    return undefined;
  }
};

const relative = (ctx: ToolContext) => path.relative(ctx.projectRoot, planFile(ctx.projectRoot));

/** Save the plan. The result names the file so the person knows where to read and edit it. */
export async function planWriteRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  if (typeof args.content !== 'string' || !args.content.trim()) throw new Error('plan_write needs "content": the plan as markdown.');
  ensureProjectStateDir(ctx.projectRoot);
  await fs.promises.writeFile(planFile(ctx.projectRoot), args.content.endsWith('\n') ? args.content : `${args.content}\n`, 'utf8');
  const lines = args.content.split('\n').length;
  return {
    output: `Plan saved to ${relative(ctx)} (${lines} lines). The person can edit it there; read it back with read_file, and hand it over with exit_plan_mode when it is ready.`,
    metadata: { path: relative(ctx), lines },
  };
}

/**
 * Hand the plan to the person. The tool always asks, with the plan as the preview, so
 * reaching the runner means they approved. The runtime switches the mode for the turns
 * that follow; this turn keeps the tools it started with.
 */
export async function exitPlanModeRunner(_args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  if (readPlan(ctx.projectRoot) === undefined) throw new Error(`There is no plan to hand over. Write it with plan_write first; it is kept at ${relative(ctx)}.`);
  if (!ctx.exitPlanMode) throw new Error('This session cannot leave plan mode from a tool; the person switches the mode.');
  const next = ctx.exitPlanMode();
  if ('refusal' in next) throw new Error(`The mode could not be changed: ${next.refusal}.`);
  return {
    output: `The plan is approved. From the next turn the session is in ${next.mode} mode, so end this turn now with what you will do first; the tools that mode offers are offered then.`,
    metadata: { mode: next.mode },
  };
}

/** The one-field form `ask_user` puts to the person: a choice among the options given, or typed text. */
export function askUserRequest(args: Record<string, any>): ElicitationRequest {
  const question = typeof args.question === 'string' ? args.question.trim() : '';
  if (!question) throw new Error('ask_user needs a "question".');
  const choices = Array.isArray(args.choices) ? args.choices.filter((choice: unknown): choice is string => typeof choice === 'string' && choice.trim().length > 0) : [];
  return {
    mode: 'form',
    server: 'JamCLI',
    message: question,
    schema: {
      properties: { answer: { type: 'string', title: choices.length ? 'Your choice' : 'Your answer', ...(choices.length ? { enum: choices } : {}) } },
      required: ['answer'],
    },
  };
}

const NO_ANSWER = 'State the assumption you will work under, say that it is one, and continue.';

/** Put one question to the person and return their answer; where no one can answer, say so and go on. */
export async function askUserRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const request = askUserRequest(args);
  if (!ctx.elicit) return { output: `No one can answer a question on this surface. ${NO_ANSWER}`, metadata: { answered: false } };
  const answer = await ctx.elicit(request);
  const text = answer.action === 'accept' ? answer.content?.answer : undefined;
  if (typeof text !== 'string' || !text.trim()) {
    return { output: `The person gave no answer${answer.action === 'decline' ? ' and declined the question' : ''}. ${NO_ANSWER}`, metadata: { answered: false } };
  }
  return { output: text, metadata: { answered: true, answer: text } };
}

/**
 * The state a summary must not lose: the todo list with its checks, and where the plan
 * is. Kept within a budget, dropping completed items first and saying how many were cut.
 */
export async function pinnedState(projectRoot: string): Promise<string | undefined> {
  const parts: string[] = [];
  const todos = await readTodos({ projectRoot });
  if (todos.length) {
    let kept = todos;
    let cut = 0;
    let text = formatTodos(kept);
    while (text.length > PINNED_BUDGET && kept.length > 1) {
      const index = kept.findIndex((todo) => todo.status === 'completed');
      kept = index >= 0 ? kept.filter((_, at) => at !== index) : kept.slice(1);
      cut += 1;
      text = formatTodos(kept);
    }
    parts.push(`Todo list${cut ? ` (${cut} ${cut === 1 ? 'item' : 'items'} left out here; todo_read has them all)` : ''}:\n${text}`);
  }
  const plan = readPlan(projectRoot);
  if (plan !== undefined) parts.push(`Plan: ${path.join(JAMCLI_DIR, PLAN_FILE)} (${plan.replace(/\n$/, '').split('\n').length} lines). Read it with read_file.`);
  return parts.length ? parts.join('\n\n') : undefined;
}

const planWriteSchema: JsonSchema = {
  type: 'object',
  properties: {
    content: { type: 'string', description: 'The whole plan, replacing the previous one.' },
  },
  required: ['content'],
  additionalProperties: false,
};

const noArguments: JsonSchema = { type: 'object', properties: {}, required: [], additionalProperties: false };

const askUserSchema: JsonSchema = {
  type: 'object',
  properties: {
    question: { type: 'string', description: 'The question and what depends on it.' },
    choices: { type: 'array', items: { type: 'string' }, description: 'Answers to pick from; omit for typed text.' },
  },
  required: ['question'],
  additionalProperties: false,
};

export const PLAN_TOOLS: RegisteredTool[] = [
  {
    name: 'plan_write',
    description: 'Save the plan as markdown to .jamcli/plan.md, where the person can read and edit it.',
    inputSchema: planWriteSchema,
    policy: 'state',
    modes: ['plan'],
    runner: planWriteRunner,
  },
  {
    name: 'exit_plan_mode',
    description: 'Hand the saved plan to the person. Approval ends plan mode from the next turn; a denial returns their feedback.',
    inputSchema: noArguments,
    policy: 'state',
    alwaysAsks: true,
    modes: ['plan'],
    runner: exitPlanModeRunner,
  },
  {
    name: 'ask_user',
    description: 'Ask the person one question. Only for what is theirs to decide.',
    inputSchema: askUserSchema,
    policy: 'state',
    runner: askUserRunner,
  },
];
