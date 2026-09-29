/**
 * The local-first path, end to end: one headless turn on a small Ollama model held to an
 * 8,192-token window, in a throwaway project, with a file the model has to read to answer.
 *
 *   bun scripts/local-path.ts [--model ollama:qwen2.5:1.5b] [--window 8192]
 *
 * It fails when the run does not end ok, when no tools were offered, or when the request did
 * not fit the window. Whether the model read the file and answered right is reported: that
 * is the model's part, not the path's.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SessionLog } from '../src/core/transcript/index.js';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1]! : fallback;
};
const model = flag('model', 'ollama:qwen2.5:1.5b');
const window = Number(flag('window', '8192'));
const repo = path.resolve(import.meta.dir, '..');

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-local-')));
const project = path.join(base, 'project');
fs.mkdirSync(path.join(project, '.jamcli'), { recursive: true });
fs.writeFileSync(path.join(project, '.jamcli', '.gitignore'), '*\n');
fs.writeFileSync(path.join(project, 'notes.txt'), 'Deploy notes.\nThe secret word is marmalade.\n');
const config = path.join(base, 'config');
fs.mkdirSync(config);
fs.writeFileSync(path.join(config, 'config.json'), `${JSON.stringify({ api_registry: { ollama: { endpoint: process.env.OLLAMA_HOST ?? 'http://localhost:11434', num_ctx: window } } }, null, 2)}\n`);
const env = { ...process.env, JAMCLI_STATE_DIR: path.join(base, 'state'), JAMCLI_CONFIG_DIR: config, JAMCLI_CACHE_DIR: path.join(base, 'cache') };

const run = spawnSync(process.execPath, ['--no-env-file', '--config=/dev/null', path.join(repo, 'src', 'index.tsx'), '-p', 'What is the secret word in notes.txt? Read the file to find out.', '--model', model, '--output-format', 'json'], {
  cwd: project,
  env,
  encoding: 'utf8',
  timeout: 10 * 60_000,
});
const problems: string[] = [];
let result: Record<string, any> = {};
try {
  result = JSON.parse(run.stdout.trim().split('\n').at(-1) ?? '');
} catch {
  problems.push(`no result object; stderr ends: ${run.stderr.trim().split('\n').slice(-3).join(' | ')}`);
}
if (result.status && result.status !== 'ok') problems.push(`the run ended ${result.status}: ${result.error ?? ''}`);

process.env.JAMCLI_STATE_DIR = env.JAMCLI_STATE_DIR;
const events = result.session_id ? SessionLog.open(project, result.session_id).events() : [];
const offered = events.filter((event) => event.type === 'context').flatMap((event) => (event as { tools?: unknown[] }).tools ?? []).length;
if (result.session_id && !offered) problems.push('no tools were offered to the model');
const prompts = events.flatMap((event) => (event.type === 'usage' ? [(event as any).usage?.prompt_tokens ?? 0] : []));
const largest = Math.max(0, ...prompts);
if (largest > window) problems.push(`a request of ${largest} tokens did not fit the ${window}-token window`);
const calls = events.flatMap((event) => (event.type === 'message' ? ((event as any).message?.tool_calls ?? []).map((call: any) => call.function?.name) : []));
const answered = /marmalade/i.test(String(result.response ?? ''));

const summary = [
  `${problems.length ? 'FAIL' : 'ok'}: ${model} at a ${window}-token window`,
  `requests ${prompts.length}, the largest ${largest} prompt tokens`,
  `tools offered ${offered}, called ${calls.length ? calls.join(', ') : 'none'}`,
  `answered ${answered ? 'right' : 'wrong or not at all'}`,
  ...problems,
].join('; ');
process.stdout.write(`${summary}\n`);
fs.rmSync(base, { recursive: true, force: true });
process.exit(problems.length ? 1 : 0);
