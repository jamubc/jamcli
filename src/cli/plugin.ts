import readline from 'readline';
import { installPlugin, installedPlugins, removePlugin, setPluginEnabled, trustProblem, updatePlugin, verifyPlugins, type ConsentRequest, type PluginScope } from '../core/plugins/store.js';
import { describePermissions } from '../core/plugins/manifest.js';

export interface PluginIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Ask a yes-or-no question; absent when nobody can answer. */
  ask?: (question: string) => Promise<boolean>;
}

export const PLUGIN_USAGE = [
  'Usage:',
  '  jamcli plugin install <path | git-url[#ref]> [--scope user|project] [--yes]',
  '  jamcli plugin list',
  '  jamcli plugin enable|disable|remove <name>',
  '  jamcli plugin update <name> [--yes]',
  '  jamcli plugin verify',
].join('\n');

const terminalAsk = (question: string) =>
  new Promise<boolean>((resolve) => {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stderr });
    prompt.question(`${question} [y/N] `, (answer) => {
      prompt.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });

const stdio: PluginIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  ...(process.stdin.isTTY ? { ask: terminalAsk } : {}),
};

/** Show what a plugin adds and may reach, then take the person's answer, or `--yes`. */
const consentWith = (io: PluginIo, yes: boolean) => async (request: ConsentRequest) => {
  io.out(`${request.manifest.name} ${request.manifest.version}${request.manifest.description ? `: ${request.manifest.description}` : ''}`);
  if (request.widened) {
    io.out('This version may reach more than the one installed:');
    for (const line of request.widened) io.out(`  + ${line}`);
  }
  io.out('It adds, and may reach:');
  for (const line of request.lines) io.out(`  ${line}`);
  if (yes) return true;
  if (!io.ask) {
    io.err('Nobody can answer here; pass --yes to consent to the above.');
    return false;
  }
  return io.ask(request.widened ? 'Allow the new permissions and update?' : 'Install it?');
};

/** `jamcli plugin ...`. */
export async function runPluginCommand(args: string[], projectRoot: string, io: PluginIo = stdio): Promise<number> {
  const yes = args.includes('--yes') || args.includes('-y');
  const scopeAt = args.indexOf('--scope');
  const scope = (scopeAt >= 0 ? args[scopeAt + 1] : 'user') as PluginScope;
  const words = args.filter((word, index) => !['--yes', '-y', '--scope'].includes(word) && !(scopeAt >= 0 && index === scopeAt + 1));
  const [action = 'list', target] = words;
  try {
    switch (action) {
      case 'list': {
        const plugins = installedPlugins(projectRoot);
        if (!plugins.length) io.out('No plugins are installed. Install one with jamcli plugin install <path | git-url>.');
        for (const plugin of plugins) {
          const untrusted = trustProblem(plugin, projectRoot);
          const state = untrusted ? `not loaded: ${untrusted}` : plugin.enabled ? 'on' : `off${plugin.disabledReason === 'integrity' ? ', its files changed' : ''}`;
          io.out(`${plugin.name} ${plugin.version} (${plugin.scope}, ${state}) from ${plugin.source}${plugin.commit ? ` at ${plugin.commit.slice(0, 12)}` : ''}`);
          io.out(`  ${describePermissions(plugin.permissions).join('; ')}`);
        }
        return 0;
      }
      case 'install': {
        if (!target) break;
        if (scope !== 'user' && scope !== 'project') {
          io.err('--scope is user or project.');
          return 2;
        }
        const installed = await installPlugin(target, { scope, projectRoot, consent: consentWith(io, yes) });
        io.out(`Installed ${installed.name} ${installed.version} for the ${scope === 'user' ? 'user' : 'project'}, ${installed.integrity}. It loads from the next session.`);
        return 0;
      }
      case 'update': {
        if (!target) break;
        const { before, after } = await updatePlugin(target, { projectRoot, consent: consentWith(io, yes) });
        io.out(before.integrity === after.integrity ? `${target} is up to date at ${after.version}.` : `Updated ${target} from ${before.version} to ${after.version}.`);
        return 0;
      }
      case 'enable':
      case 'disable': {
        if (!target) break;
        setPluginEnabled(target, projectRoot, action === 'enable');
        io.out(`${target} is ${action === 'enable' ? 'on' : 'off'} from the next session.`);
        return 0;
      }
      case 'remove': {
        if (!target) break;
        const removed = removePlugin(target, projectRoot);
        io.out(`Removed ${removed.name} ${removed.version}.`);
        return 0;
      }
      case 'verify': {
        const results = verifyPlugins(projectRoot);
        if (!results.length) io.out('No plugins are installed.');
        for (const result of results) io.out(result.ok ? `${result.name}: matches what was installed.` : `${result.name}: ${result.problem}. It is off until installed again.`);
        return results.every((result) => result.ok) ? 0 : 1;
      }
    }
  } catch (error: any) {
    io.err(error?.message ?? String(error));
    return 1;
  }
  io.err(PLUGIN_USAGE);
  return 2;
}
