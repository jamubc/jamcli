import type { CliRenderer } from '@opentui/core';
import { hostClipboard, type Copier } from '../../utils/clipboard.js';

export type { Copier };

/**
 * The system clipboard first, which works in every terminal on this machine, including
 * macOS Terminal, which ignores OSC 52. Over SSH or where no system clipboard answers,
 * the terminal's own OSC 52, which reaches the machine the person sits at.
 */
export function systemCopier(renderer: Pick<CliRenderer, 'copyToClipboardOSC52'>): { copy: Copier; dispose(): void } {
  const host = hostClipboard();
  return {
    async copy(text) {
      if (await host.write(text)) return 'system';
      return renderer.copyToClipboardOSC52(text) ? 'terminal' : false;
    },
    dispose() {
      host.dispose();
    },
  };
}
