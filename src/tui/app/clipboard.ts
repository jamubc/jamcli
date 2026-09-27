import { createHostClipboard, type CliRenderer } from '@opentui/core';

/** Put text on the clipboard. Resolves to how it got there, or false when nothing could take it. */
import type { Copier } from '../../commands/types.js';

export type { Copier };

/**
 * The system clipboard first, which works in every terminal on this machine, including
 * macOS Terminal, which ignores OSC 52. Over SSH or where no system clipboard answers,
 * the terminal's own OSC 52, which reaches the machine the person sits at.
 */
export function systemCopier(renderer: Pick<CliRenderer, 'copyToClipboardOSC52'>): { copy: Copier; dispose(): void } {
  let host: ReturnType<typeof createHostClipboard> | undefined;
  let hostFailed = false;
  return {
    async copy(text) {
      if (!hostFailed && !process.env.SSH_CONNECTION) {
        try {
          host ??= createHostClipboard();
          const result = await host.writeText(text);
          if (result.status === 'written') return 'system';
        } catch {
          // No system clipboard here: the terminal is asked instead, from now on.
        }
        hostFailed = true;
      }
      return renderer.copyToClipboardOSC52(text) ? 'terminal' : false;
    },
    dispose() {
      host?.dispose();
    },
  };
}

/** How much was copied and where, for a notice: a terminal copy may be ignored by the terminal. */
