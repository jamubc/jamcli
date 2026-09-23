import React from 'react';
import { render } from 'ink';
import { Layout } from './tui/Layout.js';
import { runCli } from './cli.js';

const argv = process.argv.slice(2);

// Avoid raw-mode errors when running under non-TTY (e.g., tsup --watch onSuccess).
if (process.stdin && process.stdin.isTTY === false) {
  process.env.INK_NO_RAW_MODE = '1';
}

const startTui = () => {
  try {
    // alternateScreen keeps transcript scrollback intact after exit, which is
    // what makes a watched run explainable afterward. incrementalRendering is
    // off because full redraws are cheaper than diffing at this frame rate.
    render(<Layout />, {
      exitOnCtrlC: false,
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      incrementalRendering: false,
      alternateScreen: false,
    });
  } catch (error) {
    console.error('Failed to start JamCLI', error);
    process.exit(1);
  }
};

const HEADLESS_INTENTS = new Set([
  '-p',
  '--prompt',
  'sessions',
  'audit',
  'mcp',
  'acp',
  '--help',
  '-h',
  '--version',
  '-v',
  '--output-format',
  '--continue',
  '--resume',
  '--allow-tool',
  '--deny-tool',
]);

const main = async () => {
  const wantsHeadless = argv.some((token) => HEADLESS_INTENTS.has(token));

  if (!wantsHeadless) {
    const cwdIndex = argv.indexOf('--cwd');
    if (cwdIndex === -1) {
      if (argv.length) {
        process.stderr.write(`Unknown option: ${argv.join(', ')}\n`);
        process.exit(2);
      }
      startTui();
      return;
    }
    const target = argv[cwdIndex + 1];
    if (!target) {
      process.stderr.write('--cwd needs a path\n');
      process.exit(2);
    }
    process.chdir(target);
    startTui();
    return;
  }

  const code = await runCli(argv);
  process.exit(code);
};

void main();

