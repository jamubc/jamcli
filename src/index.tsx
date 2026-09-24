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
  'mcp',
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
]);

const startInterface = async () => {
  const { startTui } = await import('./tui/start.js');
  startTui();
};

const main = async () => {
  if (argv.includes('--version') || argv.includes('-v')) {
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
