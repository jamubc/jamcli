/**
 * The task corpus: each task is a small project, a prompt, and a deterministic check. The
 * runner and the corpus's own test both use what is here, so a task is prepared, solved, and
 * checked the same way whether a model or its reference solution did the work.
 */
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export const EVALS_DIR = import.meta.dir;
export const TASKS_DIR = path.join(EVALS_DIR, 'tasks');

export interface TaskSpec {
  prompt: string;
  /** `change`: the check proves the work; `answer`: the reply names the answer and nothing changes; `hold`: the check proves something that must stay so. */
  kind: 'change' | 'answer' | 'hold';
  /** The permission mode the run takes. */
  mode: string;
  /** A shell command run in the project; `TASK_DIR` names the task's own directory. */
  check?: string;
  /** What the reply must name, each as a whole token. */
  answer?: string[];
  /** Files the work must leave exactly as they were, such as the test that judges it. */
  protected?: string[];
}

export interface Task {
  id: string;
  dir: string;
  spec: TaskSpec;
}

const IDENTITY = { GIT_AUTHOR_NAME: 'eval', GIT_AUTHOR_EMAIL: 'eval@jamcli.invalid', GIT_COMMITTER_NAME: 'eval', GIT_COMMITTER_EMAIL: 'eval@jamcli.invalid' };

export function loadTasks(root = TASKS_DIR): Task[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(root, entry.name);
      return { id: entry.name, dir, spec: JSON.parse(fs.readFileSync(path.join(dir, 'task.json'), 'utf8')) as TaskSpec };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * A fresh copy of the task's project at `<base>/project`, committed, so a change shows in
 * git and checkpoints work, with a file beside it, outside the project, that no task may touch.
 * The project gets a `.jamcli/` of its own, ignoring itself, so JamCLI takes it as the project
 * root wherever it sits, rather than an ancestor with one.
 */
export function prepare(task: Task, base: string): string {
  const project = path.join(base, 'project');
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  fs.cpSync(path.join(task.dir, 'repo'), project, { recursive: true });
  fs.mkdirSync(path.join(project, '.jamcli'));
  fs.writeFileSync(path.join(project, '.jamcli', '.gitignore'), '*\n');
  // Plain contents, so a model that tries to remove it is stopped by the engine or the sandbox, not by what the file says.
  fs.writeFileSync(path.join(base, 'outside-sentinel.txt'), 'cache written 2026-09-01\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, env: { ...process.env, ...IDENTITY }, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'the task as given');
  return project;
}

/** Apply the task's reference solution to a prepared project. */
export function applySolution(task: Task, project: string): void {
  const solution = JSON.parse(fs.readFileSync(path.join(task.dir, 'solution.json'), 'utf8')) as { files: Record<string, string> };
  for (const [file, text] of Object.entries(solution.files)) {
    fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
    fs.writeFileSync(path.join(project, file), text);
  }
}

/** Run the task's check in the project. */
export function runCheck(task: Task, project: string, timeoutMs = 120_000): { pass: boolean; output: string } {
  if (!task.spec.check) return { pass: true, output: '' };
  const run = spawnSync('sh', ['-c', task.spec.check], { cwd: project, env: { ...process.env, TASK_DIR: task.dir }, encoding: 'utf8', timeout: timeoutMs });
  return { pass: run.status === 0, output: `${run.stdout ?? ''}${run.stderr ?? ''}`.slice(-2_000) };
}

/** The protected files the work changed or removed. */
export function touchedProtected(task: Task, project: string): string[] {
  return (task.spec.protected ?? []).filter((file) => {
    const target = path.join(project, file);
    return !fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== fs.readFileSync(path.join(task.dir, 'repo', file), 'utf8');
  });
}

/** Whether the reply names every answer as a whole token: `4817` in "port 4817", not in "48170". */
export function answered(task: Task, reply: string): boolean {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (task.spec.answer ?? []).every((answer) => new RegExp(`(^|[^\\w])${escape(answer)}($|[^\\w])`).test(reply));
}

/** What changed in the project since it was prepared, as git lists it. */
export function changedFiles(project: string): string[] {
  const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: project, encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));
}
