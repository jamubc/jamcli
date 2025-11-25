import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { useEffect, useRef } from 'react';
import clipboard from 'clipboardy';

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 600;
const MAX_COPY_CHARS = 250_000;

const readPrimarySelection = async (): Promise<string | null> => {
  if (process.platform !== 'linux') {
    return null;
  }

  const candidates: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'wl-paste', args: ['--primary', '--no-newline'] },
    { cmd: 'xclip', args: ['-o', '-selection', 'primary'] },
  ];

  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(candidate.cmd, candidate.args, {
        timeout: 200,
        maxBuffer: MAX_COPY_CHARS * 4,
      });
      const text = stdout.replace(/\s+$/, '');
      if (text.length === 0) continue;
      return text.slice(0, MAX_COPY_CHARS);
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        continue; // Command not available; try the next candidate.
      }
      // If the command exists but nothing is selected, it may exit non-zero. Ignore and continue.
    }
  }

  return null;
};

/**
 * Watches the primary selection (Linux) and mirrors any highlighted text to the clipboard.
 * This keeps mouse-drag selections copy-friendly without extra key presses.
 */
export const useAutoCopySelection = () => {
  const lastCopiedRef = useRef<string>('');

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    let disposed = false;
    let polling = false;

    const pollSelection = async () => {
      if (polling) return;
      polling = true;
      try {
        const selection = await readPrimarySelection();
        if (!selection || disposed) return;
        if (selection !== lastCopiedRef.current) {
          await clipboard.write(selection);
          lastCopiedRef.current = selection;
        }
      } catch {
        // Best-effort; ignore transient clipboard/selection failures.
      } finally {
        polling = false;
      }
    };

    interval = setInterval(pollSelection, POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, []);
};
