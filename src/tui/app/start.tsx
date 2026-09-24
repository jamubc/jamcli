/** @jsxImportSource @opentui/react */
import { createRuntime } from '../../core/runtime/index.js';
import { resolveJamcliProjectRoot } from '../../utils/projectRoot.js';
import { App } from './App.js';

/**
 * Start the OpenTUI interface. OpenTUI draws through native code that Bun loads; on Node
 * it needs a newer release and an experimental flag, so the interface asks for Bun.
 */
export async function startOpenTui(projectRoot: string = resolveJamcliProjectRoot()): Promise<void> {
  if (!process.versions.bun) {
    process.stderr.write('This interface runs on Bun. Start it with: bun $(which jamcli)\n');
    process.exit(1);
  }
  const [{ createCliRenderer }, { createRoot }] = await Promise.all([import('@opentui/core'), import('@opentui/react')]);
  const runtime = await createRuntime({ projectRoot, surface: 'tui' });
  // JamCLI answers Ctrl+C itself: the first stops a turn, and two in a row leave.
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  let closing = false;
  const exit = async (code = 0) => {
    if (closing) return;
    closing = true;
    renderer.destroy();
    await runtime.close().catch(() => undefined);
    process.exit(code);
  };
  process.once('SIGTERM', () => void exit(143));
  process.once('SIGHUP', () => void exit(129));
  createRoot(renderer).render(<App runtime={runtime} projectRoot={projectRoot} onExit={() => void exit()} />);
}
