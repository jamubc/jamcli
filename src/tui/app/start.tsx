/** @jsxImportSource @opentui/react */
import { createRuntime } from '../../core/runtime/index.js';
import { resolveJamcliProjectRoot } from '../../utils/projectRoot.js';
import { App } from './App.js';
import type { SessionChoice } from './commands.js';
import { resolveTheme } from './theme.js';
import { loadConfig } from '../../core/config/load.js';

/**
 * Start the OpenTUI interface. OpenTUI draws through native code that Bun loads; on Node
 * it needs a newer release and an experimental flag, so the interface asks for Bun.
 */
export async function startOpenTui(projectRoot: string = resolveJamcliProjectRoot(), options: { screenReader?: boolean } = {}): Promise<void> {
  if (!process.versions.bun) {
    process.stderr.write('This interface runs on Bun. Start it with: bun $(which jamcli)\n');
    process.exit(1);
  }
  const [{ createCliRenderer }, { createRoot }] = await Promise.all([import('@opentui/core'), import('@opentui/react')]);
  // The session on screen, which /clear, /resume, /fork, and /profile replace.
  let current = await createRuntime({ projectRoot, surface: 'tui' });
  const openSession = async (choice: SessionChoice) =>
    (current = await createRuntime({
      projectRoot,
      surface: 'tui',
      ...(choice.sessionId ? { sessionId: choice.sessionId } : {}),
      ...(choice.profile ? { env: { ...process.env, JAMCLI_PROFILE: choice.profile } } : {}),
    }));
  // JamCLI answers Ctrl+C itself: the first stops a turn, and two in a row leave.
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  let closing = false;
  const exit = async (code = 0) => {
    if (closing) return;
    closing = true;
    renderer.destroy();
    await current.close().catch(() => undefined);
    process.exit(code);
  };
  process.once('SIGTERM', () => void exit(143));
  process.once('SIGHUP', () => void exit(129));
  const ui = loadConfig({ projectRoot }).config.ui ?? {};
  createRoot(renderer).render(
    <App
      runtime={current}
      projectRoot={projectRoot}
      onExit={() => void exit()}
      openSession={openSession}
      theme={resolveTheme(ui.theme, process.env)}
      screenReader={options.screenReader === true || ui.screen_reader === true}
      reducedMotion={ui.reduced_motion === true}
    />
  );
}
