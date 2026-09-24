/** @jsxImportSource @opentui/react */
import { afterEach, beforeEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { testRender } from '@opentui/react/test-utils';
import { App } from '../App.js';
import { createRuntime, type Runtime, type RuntimeOptions } from '../../../core/runtime/index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';

export type Setup = Awaited<ReturnType<typeof testRender>>;

/**
 * The frame once it matches. The renderer's own waits stop when it has nothing
 * scheduled, but a turn's work arrives from the network and a lone Escape from a timer,
 * so this renders and looks again in real time.
 */
export async function frameWith(setup: Setup, match: (frame: string) => boolean, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let frame = '';
  while (Date.now() < deadline) {
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    if (match(frame)) return frame;
    await Bun.sleep(10);
  }
  throw new Error(`No matching frame within ${timeoutMs} ms. The last:\n${frame}`);
}

/**
 * A project with a user configuration pointing at a fake Ollama, fresh for each test,
 * and a way to open the interface on a runtime in it.
 */
export function interfaceHarness() {
  const context = { server: undefined as unknown as FakeProviderServer, root: '' };
  const shared = process.env.JAMCLI_CONFIG_DIR;
  beforeEach(() => {
    context.server = startFakeProvider();
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-app-')));
    context.root = path.join(base, 'project');
    fs.mkdirSync(context.root);
    process.env.JAMCLI_CONFIG_DIR = path.join(base, 'user');
    fs.mkdirSync(process.env.JAMCLI_CONFIG_DIR);
    fs.writeFileSync(
      path.join(process.env.JAMCLI_CONFIG_DIR, 'config.json'),
      JSON.stringify({ api_registry: { ollama: { endpoint: context.server.ollamaBaseUrl } }, model: 'ollama:fake-model', sandbox: { enabled: false } })
    );
  });
  afterEach(() => {
    context.server.close();
    process.env.JAMCLI_CONFIG_DIR = shared;
    fs.rmSync(path.dirname(context.root), { recursive: true, force: true });
  });
  const open = async (options: Partial<RuntimeOptions> = {}, onExit = () => undefined): Promise<{ runtime: Runtime; setup: Setup; close: () => Promise<void> }> => {
    const runtime = await createRuntime({ projectRoot: context.root, surface: 'tui', mcp: false, env: {}, ...options });
    const setup = await testRender(<App runtime={runtime} projectRoot={context.root} onExit={onExit} />, { width: 100, height: 30, exitOnCtrlC: false });
    await setup.renderOnce();
    return {
      runtime,
      setup,
      close: async () => {
        setup.renderer.destroy();
        await runtime.close();
      },
    };
  };
  return { context, open };
}
