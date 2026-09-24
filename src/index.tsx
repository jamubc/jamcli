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

const startInterface = async () => {
  // The OpenTUI interface is chosen by JAMCLI_INTERFACE=opentui until it replaces the Ink one.
  if (process.env.JAMCLI_INTERFACE === 'opentui') {
    const { startOpenTui } = await import('./tui/app/start.js');
    await startOpenTui();
    return;
  }
  const { startTui } = await import('./tui/start.js');
  startTui();
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

  const cwdIndex = argv.indexOf('--cwd');
  if (cwdIndex === -1) {
    if (argv.length) {
      process.stderr.write(`Unknown option: ${argv.join(', ')}\n`);
      process.exit(2);
    }
    await startInterface();
    return;
  }
  const target = argv[cwdIndex + 1];
  if (!target) {
    process.stderr.write('--cwd needs a path\n');
    process.exit(2);
  }
  process.chdir(target);
  await startInterface();
};

void main();
