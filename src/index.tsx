/**
 * The entry point reads the arguments before it loads anything heavy: `--version` loads
 * only the version, the command surfaces load the runtime without the interface, and
 * only a bare `jamcli` loads React and Ink.
 */

const argv = process.argv.slice(2);

const HEADLESS_INTENTS = new Set([
  '-p',
  '--prompt',
  'sessions',
  'audit',
  'doctor',
  'mcp',
  'config',
  'auth',
  'acp',
  'skill',
  'hooks',
  'plugin',
  'workflow',
  '--help',
  '-h',
  '--output-format',
  '--continue',
  '--resume',
  '--allow-tool',
  '--deny-tool',
  '--allowed-tools',
  '--disallowed-tools',
  '--permission-mode',
  '--dangerously-bypass-permissions',
  '--dry-run',
  '-v',
  '-vv',
  '--verbose',
  '--log-file',
  '--trace-file',
]);

/** Flags only the interface reads. */
const INTERFACE_FLAGS = new Set(['--screen-reader']);

/** The interface's arguments: its own flags, and `--cwd` and `--worktree` with their values. */
const interfaceArguments = () => {
  const found: { cwd?: string; worktree?: string; unknown: string[]; missing?: string } = { unknown: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--cwd' || token === '--worktree') {
      const value = argv[i + 1];
      if (value === undefined) found.missing = token === '--cwd' ? '--cwd needs a path' : '--worktree needs a name';
      else found[token === '--cwd' ? 'cwd' : 'worktree'] = value;
      i += 1;
    } else if (!INTERFACE_FLAGS.has(token)) found.unknown.push(token);
  }
  return found;
};

const main = async () => {
  // `-v` alone is the version, as it always was; with anything else it asks for more log detail.
  if (argv.includes('--version') || (argv.length === 1 && argv[0] === '-v')) {
    const { JAMCLI_VERSION } = await import('./core/version.js');
    process.stdout.write(`${JAMCLI_VERSION}\n`);
    return;
  }

  if (argv.some((token) => HEADLESS_INTENTS.has(token))) {
    const { runCli } = await import('./cli.js');
    process.exit(await runCli(argv));
  }

  const found = interfaceArguments();
  if (found.unknown.length) {
    process.stderr.write(`Unknown option: ${found.unknown.join(', ')}\n`);
    process.exit(2);
  }
  if (found.missing) {
    process.stderr.write(`${found.missing}\n`);
    process.exit(2);
  }
  if (found.cwd) process.chdir(found.cwd);
  const { startOpenTui } = await import('./tui/app/start.js');
  await startOpenTui(undefined, { screenReader: argv.includes('--screen-reader'), ...(found.worktree !== undefined ? { worktree: found.worktree } : {}) });
};

void main();
