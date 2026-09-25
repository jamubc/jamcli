import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

/** Written into every file a trigger creates, so JamCLI knows which are its own. */
const MARK = 'jamcli-workflow';

const GIT_HOOKS = ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-push', 'post-checkout', 'post-merge', 'pre-rebase'];

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** The script a git hook runs: the workflow, headless, failing the git command when the run fails. */
export const gitHookScript = (workflow: string, jamcli: string) =>
  `#!/bin/sh\n# ${MARK}: written by jamcli workflow hook install. Remove it with jamcli workflow hook remove.\nexec ${quote(jamcli)} workflow run ${quote(workflow)} --headless\n`;

/** Install a git hook that runs a workflow. An existing hook that JamCLI did not write is left alone. */
export function installGitHook(projectRoot: string, hook: string, workflow: string, jamcli: string): string {
  if (!GIT_HOOKS.includes(hook)) throw new Error(`${hook} is not a git hook JamCLI installs. Use one of ${GIT_HOOKS.join(', ')}.`);
  const file = path.resolve(projectRoot, execFileSync('git', ['rev-parse', '--git-path', `hooks/${hook}`], { cwd: projectRoot, encoding: 'utf8' }).trim());
  if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(MARK)) throw new Error(`${file} exists and was not written by JamCLI, so it is left as it is.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, gitHookScript(workflow, jamcli), { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return file;
}

export function removeGitHook(projectRoot: string, hook: string): string | undefined {
  const file = path.resolve(projectRoot, execFileSync('git', ['rev-parse', '--git-path', `hooks/${hook}`], { cwd: projectRoot, encoding: 'utf8' }).trim());
  if (!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').includes(MARK)) return undefined;
  fs.rmSync(file);
  return file;
}

/** A five-field cron expression, each field `*`, a number, or, for minutes and hours, `*\/n`. */
export interface CronFields {
  minute: string;
  hour: string;
  day: string;
  month: string;
  weekday: string;
}

export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`"${expression}" is not a five-field cron expression, such as "0 9 * * 1-5".`);
  for (const part of parts) if (!/^(\*|\*\/\d+|\d+(-\d+)?(,\d+(-\d+)?)*)$/.test(part)) throw new Error(`"${part}" in "${expression}" is not a cron field JamCLI writes.`);
  const [minute, hour, day, month, weekday] = parts;
  return { minute, hour, day, month, weekday };
}

const marker = (projectRoot: string, workflow: string) => `# ${MARK} ${projectRoot} ${workflow}`;

/** The crontab line for a schedule: change to the project, then run the workflow headless. */
export const cronLine = (cron: string, projectRoot: string, workflow: string, jamcli: string) =>
  `${Object.values(parseCron(cron)).join(' ')} cd ${quote(projectRoot)} && ${quote(jamcli)} workflow run ${quote(workflow)} --headless ${marker(projectRoot, workflow)}`;

/** A crontab with this workflow's line replaced, or removed when `line` is absent. */
export function editCrontab(current: string, projectRoot: string, workflow: string, line?: string): string {
  const kept = current.split('\n').filter((entry) => entry.trim() && !entry.endsWith(marker(projectRoot, workflow)));
  return `${[...kept, ...(line ? [line] : [])].join('\n')}\n`;
}

const label = (projectRoot: string, workflow: string) => `dev.jamcli.workflow.${path.basename(projectRoot).replace(/[^\w-]/g, '-')}.${workflow}`;

/** A launchd agent that runs the workflow on the cron's fixed fields; ranges and steps do not map. */
export function launchdPlist(cron: string, projectRoot: string, workflow: string, jamcli: string): string {
  const fields = parseCron(cron);
  const keys: [keyof CronFields, string][] = [
    ['minute', 'Minute'],
    ['hour', 'Hour'],
    ['day', 'Day'],
    ['month', 'Month'],
    ['weekday', 'Weekday'],
  ];
  const interval = keys.flatMap(([field, key]) => {
    const value = fields[field];
    if (value === '*') return [];
    if (!/^\d+$/.test(value)) throw new Error(`launchd cannot express "${value}" for ${field}; use a single number or *.`);
    return [`      <key>${key}</key><integer>${Number(value)}</integer>`];
  });
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${MARK} -->
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${escape(label(projectRoot, workflow))}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${escape(jamcli)}</string><string>workflow</string><string>run</string><string>${escape(workflow)}</string><string>--headless</string>
    </array>
    <key>WorkingDirectory</key><string>${escape(projectRoot)}</string>
    <key>StartCalendarInterval</key>
    <dict>
${interval.join('\n')}
    </dict>
  </dict>
</plist>
`;
}

/** A Task Scheduler definition: daily (`m h * * *`) or weekly (`m h * * d`) only. */
export function windowsTaskXml(cron: string, projectRoot: string, workflow: string, jamcli: string): string {
  const fields = parseCron(cron);
  if (!/^\d+$/.test(fields.minute) || !/^\d+$/.test(fields.hour) || fields.day !== '*' || fields.month !== '*' || !/^(\*|\d)$/.test(fields.weekday)) {
    throw new Error('Windows schedules are daily ("m h * * *") or weekly ("m h * * d").');
  }
  const time = `${fields.hour.padStart(2, '0')}:${fields.minute.padStart(2, '0')}:00`;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const schedule =
    fields.weekday === '*'
      ? '<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>'
      : `<ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><${days[Number(fields.weekday) % 7]} /></DaysOfWeek></ScheduleByWeek>`;
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-16"?>
<!-- ${MARK} -->
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-01-01T${time}</StartBoundary>
      ${schedule}
    </CalendarTrigger>
  </Triggers>
  <Actions>
    <Exec>
      <Command>${escape(jamcli)}</Command>
      <Arguments>workflow run ${escape(workflow)} --headless</Arguments>
      <WorkingDirectory>${escape(projectRoot)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

export interface ScheduleSystem {
  platform: NodeJS.Platform;
  /** Read and write the user's crontab. */
  readCrontab: () => string;
  writeCrontab: (text: string) => void;
  /** Where launchd agents go. */
  launchAgentsDir: string;
  /** Load or unload a launchd agent, or register or delete a Windows task. */
  run: (file: string, args: string[]) => void;
}

export const systemSchedules = (): ScheduleSystem => ({
  platform: process.platform,
  readCrontab: () => {
    try {
      return execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return '';
    }
  },
  writeCrontab: (text) => void execFileSync('crontab', ['-'], { input: text }),
  launchAgentsDir: path.join(os.homedir(), 'Library', 'LaunchAgents'),
  run: (file, args) => void execFileSync(file, args, { stdio: 'ignore' }),
});

/** Schedule a workflow with the operating system; there is no JamCLI daemon. Returns where it went. */
export function scheduleWorkflow(cron: string, projectRoot: string, workflow: string, jamcli: string, system: ScheduleSystem = systemSchedules()): string {
  if (system.platform === 'darwin') {
    const file = path.join(system.launchAgentsDir, `${label(projectRoot, workflow)}.plist`);
    fs.mkdirSync(system.launchAgentsDir, { recursive: true });
    fs.writeFileSync(file, launchdPlist(cron, projectRoot, workflow, jamcli));
    system.run('launchctl', ['load', '-w', file]);
    return file;
  }
  if (system.platform === 'win32') {
    const file = path.join(projectRoot, '.jamcli', 'workflows', `${workflow}.task.xml`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, windowsTaskXml(cron, projectRoot, workflow, jamcli));
    system.run('schtasks', ['/Create', '/F', '/TN', label(projectRoot, workflow), '/XML', file]);
    return file;
  }
  system.writeCrontab(editCrontab(system.readCrontab(), projectRoot, workflow, cronLine(cron, projectRoot, workflow, jamcli)));
  return 'the user crontab';
}

export function unscheduleWorkflow(projectRoot: string, workflow: string, system: ScheduleSystem = systemSchedules()): boolean {
  if (system.platform === 'darwin') {
    const file = path.join(system.launchAgentsDir, `${label(projectRoot, workflow)}.plist`);
    if (!fs.existsSync(file)) return false;
    try {
      system.run('launchctl', ['unload', file]);
    } catch {}
    fs.rmSync(file);
    return true;
  }
  if (system.platform === 'win32') {
    try {
      system.run('schtasks', ['/Delete', '/F', '/TN', label(projectRoot, workflow)]);
    } catch {
      return false;
    }
    fs.rmSync(path.join(projectRoot, '.jamcli', 'workflows', `${workflow}.task.xml`), { force: true });
    return true;
  }
  const before = system.readCrontab();
  const after = editCrontab(before, projectRoot, workflow);
  if (after.trim() === before.trim()) return false;
  system.writeCrontab(after);
  return true;
}

/** This project's scheduled workflows, as the crontab or the launch agents record them. */
export function listSchedules(projectRoot: string, system: ScheduleSystem = systemSchedules()): string[] {
  if (system.platform === 'darwin') {
    if (!fs.existsSync(system.launchAgentsDir)) return [];
    const prefix = label(projectRoot, '');
    return fs.readdirSync(system.launchAgentsDir).filter((entry) => entry.startsWith(prefix) && entry.endsWith('.plist')).map((entry) => entry.slice(prefix.length, -'.plist'.length));
  }
  if (system.platform === 'win32') {
    const dir = path.join(projectRoot, '.jamcli', 'workflows');
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((entry) => entry.endsWith('.task.xml')).map((entry) => entry.slice(0, -'.task.xml'.length)) : [];
  }
  return system
    .readCrontab()
    .split('\n')
    .filter((line) => line.includes(`# ${MARK} ${projectRoot} `))
    .map((line) => `${line.split(`# ${MARK} ${projectRoot} `)[1]}: ${line.split(' ').slice(0, 5).join(' ')}`);
}
