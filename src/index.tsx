import React from 'react';
import { render } from 'ink';
import { Layout } from './components/Layout.js';

// Avoid raw-mode errors when running under non-TTY (e.g., tsup --watch onSuccess).
if (process.stdin && process.stdin.isTTY === false) {
  process.env.INK_NO_RAW_MODE = '1';
}

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
