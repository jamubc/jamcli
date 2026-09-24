import { createRuntime, type Runtime, type RuntimeOptions } from '../core/runtime/index.js';

export type InterfaceRuntimeOptions = Omit<RuntimeOptions, 'surface'>;

/**
 * The one call the interface makes for its session. The interface renders the runtime's
 * events and answers its approval requests; everything else comes from the factory, as it
 * does for headless runs and ACP sessions.
 */
export const createInterfaceRuntime = (options: InterfaceRuntimeOptions): Promise<Runtime> =>
  createRuntime({ ...options, surface: 'tui' });
