import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SessionHooks } from '../hooks.js';
import { createHookBus, hookVerdict } from '../../hooks/index.js';
import { HookTrust } from '../../hooks/commands.js';
import { createSession } from '../../state.js';

let dir: string;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-session-hooks-')));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const none = { kind: 'none' as const, reason: 'test', wrap: () => ({ file: 'sh', args: [] }) };
const layer = (scope: string, command: string) => ({ scope, label: `${scope} config`, values: { hooks: { session_start: [{ command }] } } });
const started = async (bus: ReturnType<typeof createHookBus>) =>
  (await hookVerdict(bus, 'session_start', { session: createSession(dir, 's1'), profile: 'default', source: 'new' })).context;

const hooks = (trust: HookTrust) => {
  const bus = createHookBus();
  const session = new SessionHooks({
    bus,
    layers: [layer('user', 'echo from-user'), layer('project', 'echo from-project')],
    plugins: [],
    projectRoot: dir,
    workRoot: dir,
    surface: 'headless',
    sessionId: () => 's1',
    env: () => ({ PATH: process.env.PATH ?? '' }),
    sandbox: none,
    matches: () => true,
    trust,
  });
  return { bus, session };
};

test("the user's hooks run at once, and the project's only once trusted, for later sessions too", async () => {
  const trust = new HookTrust(path.join(dir, 'trusted.json'));
  const first = hooks(trust);
  expect(first.session.commands.map((hook) => hook.command)).toEqual(['echo from-user', 'echo from-project']);
  expect(first.session.projectTrusted).toBe(false);
  expect(first.session.notice).toBe('This project configures 1 hook not yet trusted, so it does not run. Review them with /hooks, or trust them with jamcli hooks trust.');
  expect(await started(first.bus)).toEqual(['from-user']);

  first.session.trust();
  expect(first.session.projectTrusted).toBe(true);
  expect(first.session.notice).toBeUndefined();
  expect(await started(first.bus)).toEqual(['from-user', 'from-project']);

  const later = hooks(trust);
  expect(later.session.projectTrusted).toBe(true);
  expect(await started(later.bus)).toEqual(['from-user', 'from-project']);
});
