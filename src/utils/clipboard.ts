/** Put text on the clipboard. Resolves to how it got there, or false when nothing could take it. */
export type Copier = (text: string) => Promise<'system' | 'terminal' | false>;

/**
 * The machine's own clipboard, through OpenTUI's host clipboard, loaded only when text is
 * first copied. Over SSH there is none worth writing: the person sits at another machine.
 */
export function hostClipboard(): { write(text: string): Promise<boolean>; dispose(): void } {
  let host: { writeText(text: string): Promise<{ status: string }>; dispose(): void } | undefined;
  let failed = Boolean(process.env.SSH_CONNECTION);
  return {
    async write(text) {
      if (failed) return false;
      try {
        if (!host) {
          const { createHostClipboard } = await import('@opentui/core');
          host = createHostClipboard();
        }
        if ((await host.writeText(text)).status === 'written') return true;
      } catch {
        // No system clipboard here; it is not asked again.
      }
      failed = true;
      return false;
    },
    dispose() {
      host?.dispose();
    },
  };
}
