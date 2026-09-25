/** @jsxImportSource @opentui/react */
import { createInterfaceRuntime } from '../runtime.js';
import { resolveJamcliProjectRoot } from '../../utils/projectRoot.js';
import { App } from './App.js';
import type { SessionChoice } from './commands.js';
import { resolveTheme } from './theme.js';
import { loadConfig } from '../../core/config/load.js';
import { isFirstRun } from '../../core/onboarding/index.js';
import { statusStyleFor } from './statusStyle.js';
import type { ObserverHub } from '../observer.js';

/**
 * Start the OpenTUI interface. OpenTUI draws through native code that Bun loads; on Node
 * it needs a newer release and an experimental flag, so the interface asks for Bun.
 */
export async function startOpenTui(projectRoot: string = resolveJamcliProjectRoot(), options: { screenReader?: boolean; worktree?: string } = {}): Promise<void> {
  if (!process.versions.bun) {
    process.stderr.write('This interface runs on Bun. Start it with: bun $(which jamcli)\n');
    process.exit(1);
  }
  // `--worktree`: every session this interface opens works in that worktree.
  let workTree: string | undefined;
  if (options.worktree !== undefined) {
    try {
      workTree = (await (await import('../../core/git/worktrees.js')).openWorktree(projectRoot, options.worktree)).dir;
    } catch (error: any) {
      process.stderr.write(`${error?.message ?? error}\n`);
      process.exit(1);
    }
  }
  const [{ createCliRenderer }, { createRoot }] = await Promise.all([import('@opentui/core'), import('@opentui/react')]);
  // The session on screen, which /clear, /resume, /fork, and /profile replace. It opens
  // while the terminal is set up, and the style is read meanwhile, so neither waits.
  const settings = loadConfig({ projectRoot });
  const ui = settings.config.ui ?? {};
  // JamCLI answers Ctrl+C itself: the first stops a turn, and two in a row leave.
  const setUp = createCliRenderer({ exitOnCtrlC: false });
  const [opened, statusStyle] = await Promise.all([createInterfaceRuntime({ projectRoot, ...(workTree ? { workTree } : {}) }), statusStyleFor(ui)]).catch(async (error) => {
    // A session that cannot open leaves the terminal as it found it.
    (await setUp).destroy();
    throw error;
  });
  const renderer = await setUp;
  let current = opened;
  // JAMCLI_ACP_ENDPOINT=unix:<path> serves the session on screen to ACP observers.
  let observer: ObserverHub | undefined;
  // Loaded only when asked for, so the interface starts as fast without it.
  try {
    if (process.env.JAMCLI_ACP_ENDPOINT) {
      const { observerPath, startObserver } = await import('../observer.js');
      observer = await startObserver(observerPath(process.env.JAMCLI_ACP_ENDPOINT)!, opened);
    }
  } catch (error: any) {
    opened.notices.push(`The ACP observer endpoint is off: ${error?.message ?? error}`);
  }
  const openSession = async (choice: SessionChoice) =>
    (current = await createInterfaceRuntime({
      projectRoot,
      ...(workTree ? { workTree } : {}),
      ...(choice.sessionId ? { sessionId: choice.sessionId } : {}),
      ...(choice.profile ? { env: { ...process.env, JAMCLI_PROFILE: choice.profile } } : {}),
    }));
  let closing = false;
  const exit = async (code = 0) => {
    if (closing) return;
    closing = true;
    renderer.destroy();
    await observer?.close().catch(() => undefined);
    await current.close().catch(() => undefined);
    process.exit(code);
  };
  process.once('SIGTERM', () => void exit(143));
  process.once('SIGHUP', () => void exit(129));
  createRoot(renderer).render(
    <App
      runtime={current}
      projectRoot={projectRoot}
      onExit={() => void exit()}
      openSession={openSession}
      theme={resolveTheme(ui.theme, process.env)}
      screenReader={options.screenReader === true || ui.screen_reader === true}
      reducedMotion={ui.reduced_motion === true}
      firstRun={isFirstRun(settings)}
      statusStyle={statusStyle}
      {...(observer ? { observer } : {})}
    />
  );
}
