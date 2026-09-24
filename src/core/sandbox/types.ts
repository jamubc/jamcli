import type { EnvPolicy } from './env.js';

export type SandboxKind = 'none' | 'bwrap' | 'seatbelt';

/** The `sandbox` block of configuration. */
export interface SandboxSettings {
  /** On by default wherever a sandbox works. */
  enabled?: boolean;
  /** Off by default. */
  network?: boolean;
  /** Directories besides the project and the temporary directory that commands may write. */
  writable?: string[];
  /** Paths hidden in addition to the defaults. */
  hidden?: string[];
  /** How much of JamCLI's environment commands and servers inherit. */
  env?: EnvPolicy;
  /** Variables passed to every process by name, even when they look like credentials. */
  env_passthrough?: string[];
}

export interface Sandbox {
  readonly kind: SandboxKind;
  /** Why this kind, such as the probe that failed when there is none. */
  readonly reason: string;
  /** Added to a failed command's result, so the model and the user know the sandbox was involved. */
  readonly note?: string;
  /** Rewrite a shell command so it runs inside the sandbox. */
  wrap(command: string, options: { cwd: string; env: Record<string, string> }): { file: string; args: string[] };
}
