import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { holds, parseExpr, render } from '../expr.js';
import { resolveInputs, validateWorkflow, type Workflow } from '../schema.js';
import { executeWorkflow, readRunLog, recordApproval, type StepRunners } from '../engine.js';
import { cronLine, editCrontab, installGitHook, launchdPlist, listSchedules, scheduleWorkflow, unscheduleWorkflow, windowsTaskXml, type ScheduleSystem } from '../triggers.js';
import { runWorkflowCommand } from '../../../cli/workflow.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';

let root: string;
let provider: FakeProviderServer;
let previousState: string | undefined;
beforeAll(() => {
  provider = startFakeProvider();
});
afterAll(() => provider.close());
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-workflows-')));
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
});
afterEach(() => {
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
});

const workflow = (raw: object): Workflow => validateWorkflow({ name: 'w', ...raw }, 'w.yaml');

test('conditions are parsed, never evaluated as code, and templates read only paths', () => {
  const context = { inputs: { issue: 'bug', count: 3 }, steps: { test: { status: 'ok', output: 'passed' } } };
  expect(holds("steps.test.status == 'ok' and inputs.count >= 3", context)).toBe(true);
  expect(holds('not (inputs.count < 2 or steps.test.status != "ok")', context)).toBe(true);
  expect(holds('steps.missing.status == null', context)).toBe(true);
  expect(() => parseExpr('process.exit()')).toThrow('unexpected "("');
  expect(() => parseExpr('inputs.a ==')).toThrow('the condition ends too early');
  expect(() => parseExpr('a; b')).toThrow('unexpected ";"');
  expect(render('Fix {{ inputs.issue }} after {{steps.test.output}}{{ inputs.none }}.', context)).toBe('Fix bug after passed.');
});

test('a workflow is checked when it loads: ids, needs, cycles, conditions, templates, and one kind per step', () => {
  expect(() => workflow({ steps: [{ id: 'a', run: 'x' }, { id: 'a', run: 'y' }] })).toThrow('step a is defined twice');
  expect(() => workflow({ steps: [{ id: 'a', needs: ['z'], run: 'x' }] })).toThrow('step a needs z, which is not a step');
  expect(() => workflow({ steps: [{ id: 'a', needs: ['b'], run: 'x' }, { id: 'b', needs: ['a'], run: 'y' }] })).toThrow('the steps form a cycle: a -> b -> a');
  expect(() => workflow({ steps: [{ id: 'a', when: 'x ==', run: 'x' }] })).toThrow('has a condition that does not parse');
  expect(() => workflow({ steps: [{ id: 'a', run: 'x' }, { id: 'b', run: 'echo {{ steps.a.output }}' }] })).toThrow('step b in a template names steps.a.output, which is not an input or the status or output of a step it needs');
  expect(() => workflow({ steps: [{ id: 'a', run: 'x', approval: { message: 'm' } }] })).toThrow('must have exactly one of agent, run, tool, approval, commit, or workflow');
  expect(() => workflow({ concurrency: 9, steps: [{ id: 'a', run: 'x' }] })).toThrow('concurrency');
  const typed = workflow({ inputs: { n: { type: 'number', required: true }, flag: { type: 'boolean', default: false } }, steps: [{ id: 'a', run: 'x' }] });
  expect(resolveInputs(typed, { n: '4' })).toEqual({ n: 4, flag: false });
  expect(() => resolveInputs(typed, {})).toThrow('needs the input n');
  expect(() => resolveInputs(typed, { n: '1', other: 'x' })).toThrow('has no input other');
});

/** Runners that record what ran, finish after a tick, and fail commands starting with "fail". */
const fakeRunners = (log: string[], answer: 'approved' | 'rejected' | 'wait' = 'wait') => {
  let active = 0;
  const peak = { value: 0 };
  const step = async (label: string, ok = true) => {
    active += 1;
    peak.value = Math.max(peak.value, active);
    log.push(label);
    await Bun.sleep(15);
    active -= 1;
    return { ok, output: `${label} done` };
  };
  const runners: StepRunners = {
    agent: (step, prompt) => step && step.id ? runnersStep(`agent:${prompt}`) : runnersStep('agent'),
    run: (command) => step(`run:${command}`, !command.startsWith('fail')),
    tool: (name) => step(`tool:${name}`),
    approval: async (message) => (log.push(`approval:${message}`), answer),
    commit: (message) => step(`commit:${message}`),
    workflow: (name) => step(`workflow:${name}`),
  };
  function runnersStep(label: string) {
    return step(label);
  }
  return { runners, peak };
};

test('steps run when their needs finish, up to the concurrency; a failure fails dependents unless they continue; false conditions skip', async () => {
  const log: string[] = [];
  const { runners, peak } = fakeRunners(log);
  const flow = workflow({
    concurrency: 2,
    steps: [
      { id: 'a', run: 'one' },
      { id: 'b', run: 'two' },
      { id: 'c', run: 'three' },
      { id: 'd', needs: ['a', 'b', 'c'], run: 'fail now' },
      { id: 'e', needs: ['d'], run: 'never' },
      { id: 'f', needs: ['d'], continue_on_error: true, run: 'after {{ steps.d.status }}' },
      { id: 'g', needs: ['f'], when: "steps.f.status == 'failed'", run: 'skipped' },
    ],
  });
  const summary = await executeWorkflow(flow, { projectRoot: root, inputs: {}, runners });
  expect(peak.value).toBe(2);
  expect(Object.fromEntries(Object.entries(summary.steps).map(([id, state]) => [id, state.status]))).toEqual({ a: 'ok', b: 'ok', c: 'ok', d: 'failed', e: 'failed', f: 'ok', g: 'skipped' });
  expect(summary.steps.e.output).toBe('It needs d, which did not succeed.');
  expect(log).toContain('run:after failed');
  expect(log).not.toContain('run:never');
  expect(summary.status).toBe('failed');
  const events = readRunLog(root, summary.runId);
  expect(events[0]).toMatchObject({ type: 'start', workflow: 'w' });
  expect(events.at(-1)).toMatchObject({ type: 'end', status: 'failed' });
});

test('an approval nobody can answer waits; approving resumes at the first unfinished step, and a cut-off step runs again', async () => {
  const log: string[] = [];
  const flow = workflow({
    inputs: { issue: { type: 'string', required: true } },
    steps: [
      { id: 'plan', run: 'plan {{ inputs.issue }}' },
      { id: 'gate', needs: ['plan'], approval: { message: 'Plan says {{ steps.plan.output }}. Go on?' } },
      { id: 'ship', needs: ['gate'], commit: { message: 'fix: {{ inputs.issue }}' } },
    ],
  });
  const first = await executeWorkflow(flow, { projectRoot: root, inputs: { issue: 'bug' }, runners: fakeRunners(log).runners });
  expect(first.status).toBe('waiting');
  expect(first.steps.gate).toEqual({ status: 'waiting', output: 'Plan says run:plan bug done. Go on?' });
  expect(() => recordApproval(root, first.runId, 'plan', true)).toThrow('is not waiting for approval');
  recordApproval(root, first.runId, 'gate', true);
  const resumed = await executeWorkflow(flow, { projectRoot: root, inputs: {}, runners: fakeRunners(log).runners, resume: first.runId });
  expect(resumed.status).toBe('ok');
  expect(log.filter((entry) => entry.startsWith('run:plan'))).toHaveLength(1);
  expect(log).toContain('commit:fix: bug');

  // A run cut off mid-step: the log says running, and resume runs it again.
  const cut = await executeWorkflow(workflow({ steps: [{ id: 'only', run: 'x' }] }), { projectRoot: root, inputs: {}, runners: fakeRunners([]).runners });
  const file = path.join(root, '.jamcli', 'workflows', 'runs', `${cut.runId}.jsonl`);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  fs.writeFileSync(file, `${lines.filter((line) => !line.includes('"status":"ok"') && !line.includes('"type":"end"')).join('\n')}\n`);
  const again: string[] = [];
  expect((await executeWorkflow(workflow({ steps: [{ id: 'only', run: 'x' }] }), { projectRoot: root, inputs: {}, runners: fakeRunners(again).runners, resume: cut.runId })).status).toBe('ok');
  expect(again).toEqual(['run:x']);

  const stopped = new AbortController();
  stopped.abort();
  expect((await executeWorkflow(flow, { projectRoot: root, inputs: { issue: 'x' }, runners: fakeRunners([]).runners, signal: stopped.signal })).status).toBe('cancelled');
});

test('a real run: an agent step in plan mode, a command, a tool, a headless approval, then a commit after approve', async () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();
  git('init', '-q');
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.jamcli', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: provider.ollamaBaseUrl } }, active_profile: 'default', trust: { enabled: false }, sandbox: { enabled: false } }));
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(root, 'notes.txt'), 'hello\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  fs.writeFileSync(
    path.join(root, '.jamcli', 'workflows', 'fix.yaml'),
    [
      'name: fix',
      'inputs: { issue: { type: string, required: true } }',
      'steps:',
      '  - id: plan',
      '    agent: { mode: plan, prompt: "Plan a fix for {{ inputs.issue }}" }',
      '  - id: check',
      '    needs: [plan]',
      '    run: echo checked',
      '  - id: read',
      '    needs: [plan]',
      '    tool: { name: read_file, arguments: { path: notes.txt } }',
      '  - id: gate',
      '    needs: [check, read]',
      '    approval: { message: "Check said {{ steps.check.output }}. Commit?" }',
      '  - id: commit',
      '    needs: [gate]',
      '    when: "steps.check.status == \'ok\'"',
      '    commit: { message: "fix: {{ inputs.issue }}", paths: [notes.txt] }',
    ].join('\n')
  );
  provider.enqueue({ text: 'Step one: edit notes.txt.' });
  const out: string[] = [];
  const io = { out: (line: string) => out.push(line), err: (line: string) => out.push(line) };
  expect(await runWorkflowCommand(['run', 'fix', '--input', 'issue=typo', '--allow-tool', 'run_command', '--headless'], root, { io, runtime: { env: { PATH: process.env.PATH, HOME: process.env.HOME } } })).toBe(0);
  const waiting = out.find((line) => line.startsWith('Waiting for approval at gate'))!;
  expect(waiting).toContain('checked. Commit?');
  expect(provider.completions().at(-1)!.body.messages.at(-1).content).toBe('Plan a fix for typo');
  expect(out.join('\n')).toMatch(/- read: ok\n    1\|[0-9a-f]+\|hello/);
  const runId = /approve (\S+) gate/.exec(waiting)![1];

  fs.writeFileSync(path.join(root, 'notes.txt'), 'hello, fixed\n');
  out.length = 0;
  expect(await runWorkflowCommand(['approve', runId, 'gate', '--headless'], root, { io, runtime: { env: { PATH: process.env.PATH, HOME: process.env.HOME } } })).toBe(0);
  expect(out.at(-1)).toBe(`Run ${runId} of fix ended: ok.`);
  expect(git('log', '-1', '--format=%s')).toBe('fix: typo');
}, 60_000);

test('triggers are written as files: a git hook, a crontab line, a launchd agent, and a Windows task', () => {
  execFileSync('git', ['init', '-q'], { cwd: root });
  const hook = installGitHook(root, 'pre-push', 'fix', '/usr/local/bin/jamcli');
  expect(fs.readFileSync(hook, 'utf8')).toBe("#!/bin/sh\n# jamcli-workflow: written by jamcli workflow hook install. Remove it with jamcli workflow hook remove.\nexec '/usr/local/bin/jamcli' workflow run 'fix' --headless\n");
  expect(fs.statSync(hook).mode & 0o111).toBeTruthy();
  fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nmy own hook\n');
  expect(() => installGitHook(root, 'pre-commit', 'fix', 'jamcli')).toThrow('was not written by JamCLI');

  const line = cronLine('0 9 * * 1-5', root, 'fix', '/usr/local/bin/jamcli');
  expect(line).toBe(`0 9 * * 1-5 cd '${root}' && '/usr/local/bin/jamcli' workflow run 'fix' --headless # jamcli-workflow ${root} fix`);
  expect(() => cronLine('every day', root, 'fix', 'jamcli')).toThrow('is not a five-field cron expression');
  expect(editCrontab(`MAILTO=me\n${line}\n`, root, 'fix')).toBe('MAILTO=me\n');

  let crontab = 'MAILTO=me\n';
  const linux: ScheduleSystem = { platform: 'linux', readCrontab: () => crontab, writeCrontab: (text) => void (crontab = text), launchAgentsDir: path.join(root, 'agents'), run: () => undefined };
  scheduleWorkflow('30 2 * * *', root, 'fix', '/bin/jamcli', linux);
  scheduleWorkflow('45 2 * * *', root, 'fix', '/bin/jamcli', linux);
  expect(crontab.split('\n').filter(Boolean)).toHaveLength(2);
  expect(listSchedules(root, linux)).toEqual(['fix: 45 2 * * *']);
  expect(unscheduleWorkflow(root, 'fix', linux)).toBe(true);
  expect(crontab).toBe('MAILTO=me\n');

  const ran: string[][] = [];
  const mac: ScheduleSystem = { ...linux, platform: 'darwin', run: (file, args) => void ran.push([file, ...args]) };
  const plist = scheduleWorkflow('15 8 * * 1', root, 'fix', '/bin/jamcli', mac);
  expect(fs.readFileSync(plist, 'utf8')).toContain('<key>Minute</key><integer>15</integer>\n      <key>Hour</key><integer>8</integer>\n      <key>Weekday</key><integer>1</integer>');
  expect(ran[0]).toEqual(['launchctl', 'load', '-w', plist]);
  expect(listSchedules(root, mac)).toEqual(['fix']);
  expect(() => launchdPlist('*/5 * * * *', root, 'fix', 'jamcli')).toThrow('launchd cannot express');

  expect(windowsTaskXml('5 7 * * 3', root, 'fix', 'C:\\jamcli.exe')).toContain('<DaysOfWeek><Wednesday /></DaysOfWeek>');
  expect(windowsTaskXml('5 7 * * *', root, 'fix', 'C:\\jamcli.exe')).toContain('<StartBoundary>2026-01-01T07:05:00</StartBoundary>');
  expect(() => windowsTaskXml('5 7 1 * *', root, 'fix', 'jamcli')).toThrow('daily');
});
