/** @jsxImportSource @opentui/react */
import { afterEach, beforeEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { testRender } from '@opentui/react/test-utils';
import { App, type AppProps } from '../App.js';
import type { SessionChoice } from '../commands.js';
import { createRuntime, type Runtime, type RuntimeOptions } from '../../../core/runtime/index.js';
import { startFakeProvider, type FakeProviderOptions, type FakeProviderServer } from '../../../testing/fakeProvider.js';

/** How the interface is opened: its size, and the props a person's settings would give it. */
export interface ViewOptions extends Pick<AppProps, 'theme' | 'screenReader' | 'reducedMotion' | 'keys' | 'firstRun'> {
  onExit?: () => void;
  size?: { width: number; height: number };
}

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
export function interfaceHarness(provider: FakeProviderOptions = {}) {
  const context = { server: undefined as unknown as FakeProviderServer, root: '' };
  const shared = process.env.JAMCLI_CONFIG_DIR;
  const sharedState = process.env.JAMCLI_STATE_DIR;
  beforeEach(() => {
    context.server = startFakeProvider(provider);
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-app-')));
    context.root = path.join(base, 'project');
    fs.mkdirSync(context.root);
    process.env.JAMCLI_CONFIG_DIR = path.join(base, 'user');
    fs.mkdirSync(process.env.JAMCLI_CONFIG_DIR);
    process.env.JAMCLI_STATE_DIR = path.join(base, 'state');
    fs.writeFileSync(
      path.join(process.env.JAMCLI_CONFIG_DIR, 'config.json'),
      JSON.stringify({ api_registry: { ollama: { endpoint: context.server.ollamaBaseUrl } }, model: 'ollama:fake-model', sandbox: { enabled: false } })
    );
  });
  afterEach(() => {
    context.server.close();
    process.env.JAMCLI_CONFIG_DIR = shared;
    if (sharedState === undefined) delete process.env.JAMCLI_STATE_DIR;
    else process.env.JAMCLI_STATE_DIR = sharedState;
    fs.rmSync(path.dirname(context.root), { recursive: true, force: true });
  });
  const open = async (options: Partial<RuntimeOptions> = {}, view: ViewOptions = {}) => {
    const { onExit = () => undefined, size = { width: 100, height: 30 }, ...shown } = view;
    const base: RuntimeOptions = { projectRoot: context.root, surface: 'tui', mcp: false, env: {}, ...options };
    const opened: Runtime[] = [];
    const make = async (choice: SessionChoice = {}) => {
      const made = await createRuntime({
        ...base,
        ...(choice.sessionId ? { sessionId: choice.sessionId } : {}),
        ...(choice.profile ? { env: { ...base.env, JAMCLI_PROFILE: choice.profile } } : {}),
      });
      opened.push(made);
      return made;
    };
    const runtime = await make();
    const setup = await testRender(<App runtime={runtime} projectRoot={context.root} onExit={onExit} openSession={make} {...shown} />, { ...size, exitOnCtrlC: false });
    await setup.renderOnce();
    return {
      runtime,
      /** The session on screen: the last one opened. */
      current: () => opened.at(-1)!,
      setup,
      close: async () => {
        setup.renderer.destroy();
        for (const made of opened) await made.close().catch(() => undefined);
      },
    };
  };
  return { context, open };
}
