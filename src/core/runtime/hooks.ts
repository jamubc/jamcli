import type { HookBus } from '../hooks/index.js';
import { HookTrust, hooksDigest, hooksFromLayers, needsTrust, subscribeHooks, type HookCommand } from '../hooks/commands.js';
import type { PluginProcess } from '../plugins/runtime.js';
import type { Sandbox } from '../sandbox/index.js';
import type { ToolCall } from '../types.js';

export interface SessionHooksOptions {
  bus: HookBus;
  /** The configuration's layers, each of which may declare hooks. */
  layers: Parameters<typeof hooksFromLayers>[0];
  /** The enabled plugins' processes, whose hooks were consented to at install. */
  plugins: PluginProcess[];
  projectRoot: string;
  workRoot: string;
  surface: string;
  sessionId: () => string;
  /** The session's minimal environment, which the configuration's hooks run in. */
  env: () => Record<string, string>;
  sandbox: Sandbox;
  /** Whether a call is one a matcher names, judged as a permission rule would be. */
  matches: (matcher: string, call: ToolCall) => boolean;
  /** Where trust is kept; the user's state directory when not given. */
  trust?: HookTrust;
}

/**
 * The hooks a session runs. The configuration's subscribe to the bus at once, except a
 * project's, which run only once the person trusts them, since opening a repository must
 * not run its code. A plugin's run in the plugin's own sandbox.
 */
export class SessionHooks {
  readonly commands: HookCommand[];
  private readonly store: HookTrust;
  private readonly digest: string;
  private readonly projectHooks: HookCommand[];
  private trusted: boolean;

  constructor(private readonly options: SessionHooksOptions) {
    this.commands = hooksFromLayers(options.layers);
    this.store = options.trust ?? new HookTrust();
    this.digest = hooksDigest(this.commands);
    this.projectHooks = this.commands.filter(needsTrust);
    this.trusted = !this.projectHooks.length || this.store.isTrusted(options.projectRoot, this.digest);
    this.subscribe(this.commands.filter((hook) => !needsTrust(hook) || this.trusted));
    for (const { plugin, sandbox, env, hooks } of options.plugins) {
      if (!hooks.length) continue;
      subscribeHooks(options.bus, {
        hooks,
        base: this.base(),
        matches: options.matches,
        context: () => ({
          cwd: options.workRoot,
          env: { ...env, JAMCLI_PROJECT_DIR: options.projectRoot, JAMCLI_SESSION_ID: options.sessionId(), JAMCLI_PLUGIN_DIR: plugin.dir },
          ...(sandbox.kind === 'none' ? {} : { wrap: sandbox.wrap }),
        }),
      });
    }
  }

  /** Whether the project's hooks are trusted and running; true when it has none. */
  get projectTrusted(): boolean {
    return this.trusted;
  }

  /** Why some of the project's hooks do not run, or nothing when all of them do. */
  get notice(): string | undefined {
    if (this.trusted) return undefined;
    const count = this.projectHooks.filter((hook) => hook.enabled !== false).length;
    return `This project configures ${count} hook${count === 1 ? '' : 's'} not yet trusted, so ${count === 1 ? 'it does' : 'they do'} not run. Review them with /hooks, or trust them with jamcli hooks trust.`;
  }

  /** Trust the project's hooks as they are now, for this and later sessions, and start running them. */
  trust(): void {
    if (this.trusted) return;
    this.store.trust(this.options.projectRoot, this.digest);
    this.trusted = true;
    this.subscribe(this.projectHooks);
  }

  private subscribe(list: HookCommand[]): void {
    const { options } = this;
    subscribeHooks(options.bus, {
      hooks: list,
      base: this.base(),
      matches: options.matches,
      context: () => ({
        cwd: options.workRoot,
        env: { ...options.env(), JAMCLI_PROJECT_DIR: options.projectRoot, JAMCLI_SESSION_ID: options.sessionId() },
        ...(options.sandbox.kind === 'none' ? {} : { wrap: options.sandbox.wrap }),
      }),
    });
  }

  private base() {
    return { projectRoot: this.options.projectRoot, cwd: this.options.workRoot, surface: this.options.surface };
  }
}
