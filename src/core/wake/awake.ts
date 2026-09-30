import fs from 'fs';
import { spawn } from 'child_process';

/** Starts whatever keeps the machine awake while this process lives, and returns how to stop it; nothing where nothing can. */
export type AwakeSpawner = () => { stop(): void } | undefined;

const CAFFEINATE = '/usr/bin/caffeinate';

/**
 * On macOS, `caffeinate -i -w <pid>`: no idle sleep until it is stopped or this process
 * exits, whichever is first, so a crash cannot leave the machine held awake.
 */
export const caffeinate: AwakeSpawner = () => {
  if (process.platform !== 'darwin' || !fs.existsSync(CAFFEINATE)) return undefined;
  try {
    const child = spawn(CAFFEINATE, ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
    return { stop: () => void child.kill() };
  } catch {
    return undefined;
  }
};

/**
 * Keeps the machine awake while anything holds it: a running turn, a pending wake. The
 * spawner runs once for the first hold and is stopped when the last one lets go.
 */
export class KeepAwake {
  private readonly holds = new Set<string>();
  private running: { stop(): void } | undefined;

  constructor(private readonly spawner: AwakeSpawner | undefined) {}

  hold(reason: string, on: boolean): void {
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    if (this.holds.size && !this.running) this.running = this.spawner?.();
    else if (!this.holds.size && this.running) {
      this.running.stop();
      this.running = undefined;
    }
  }

  get awake(): boolean {
    return this.running !== undefined;
  }

  release(): void {
    this.holds.clear();
    this.hold('', false);
  }
}
