import { afterEach, beforeEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type Runtime } from '../../core/runtime/index.js';
import { startFakeProvider, type FakeProviderServer } from '../../testing/fakeProvider.js';
import { CommandHost, type CommandHostOptions, type HostEntry } from '../host.js';

/**
 * A project and user configuration on a fake Ollama, fresh for each test, and a command
 * host on a real runtime in it: the same host headless and ACP run commands through.
 */
export function hostFixture() {
  const context = { server: undefined as unknown as FakeProviderServer, root: '', runtimes: [] as Runtime[] };
  const shared = process.env.JAMCLI_CONFIG_DIR;
  beforeEach(() => {
    context.server = startFakeProvider();
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-host-')));
    context.root = path.join(base, 'project');
    fs.mkdirSync(context.root);
    process.env.JAMCLI_CONFIG_DIR = path.join(base, 'user');
    fs.mkdirSync(process.env.JAMCLI_CONFIG_DIR);
    fs.writeFileSync(
      path.join(process.env.JAMCLI_CONFIG_DIR, 'config.json'),
      JSON.stringify({ api_registry: { ollama: { endpoint: context.server.ollamaBaseUrl } }, model: 'ollama:fake-model', sandbox: { enabled: false } })
    );
  });
  afterEach(async () => {
    for (const runtime of context.runtimes.splice(0)) await runtime.close().catch(() => undefined);
    context.server.close();
    process.env.JAMCLI_CONFIG_DIR = shared;
    fs.rmSync(path.dirname(context.root), { recursive: true, force: true });
  });

  /** A host on a new runtime; what it produces is kept in `entries`, and turns it sends in `turns`. */
  const open = async (options: Partial<CommandHostOptions> = {}) => {
    const runtime = await createRuntime({ projectRoot: context.root, surface: 'headless', mcp: false, env: {} });
    context.runtimes.push(runtime);
    const entries: HostEntry[] = [];
    const turns: { prompt: string; options: object }[] = [];
    const host = new CommandHost({
      runtime,
      projectRoot: context.root,
      onEntry: (entry) => entries.push(entry),
      runTurn: async (prompt, turn) => {
        turns.push({ prompt, options: turn });
      },
      openRefusal: 'Open another session with --resume <id>.',
      answerHint: 'Answer with /choose <number or key>.',
      laterInput: true,
      ...options,
    });
    await host.load();
    return { host, runtime, entries, turns };
  };
  return { context, open };
}

/** Every entry's text, one per line, for matching. */
export const said = (entries: HostEntry[]) =>
  entries
    .map((entry) => (entry.kind === 'event' ? `event ${entry.event.type}` : entry.kind === 'choice' ? `choice ${entry.title}: ${entry.items.map((item) => item.key).join(' ')}` : entry.text))
    .join('\n');
