/** Open a page in the person's browser; the address is printed as well, in case it cannot. */
export async function openBrowser(url: URL): Promise<void> {
  const { spawn } = await import('child_process');
  const [command, args] = process.platform === 'darwin' ? ['open', [url.toString()]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url.toString()]] : ['xdg-open', [url.toString()]];
  try {
    spawn(command, args as string[], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  } catch {
    // The printed address is the fallback.
  }
}
