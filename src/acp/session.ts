import { createRuntime, type RuntimeOptions } from '../core/runtime/index.js';
import { ConfigService } from '../services/ConfigService.js';
import type { AgentEvent, RunResult } from '../core/types.js';
import type { AcpConfigOption } from './protocol.js';

/** What the ACP server needs from a session in order to drive a turn. */
export interface AcpSessionController {
  id: string;
  cwd: string;
  model: string;
  profile: string;
  configOptions: AcpConfigOption[];
  run(prompt: string, onEvent: (event: AgentEvent) => void): Promise<RunResult>;
  cancel(): void;
  /** Release what the session holds, such as MCP server processes. */
  close?(): Promise<void>;
}

export interface CreateAcpSessionOptions {
  projectRoot: string;
  cwd: string;
  /** Continue a recorded session instead of starting one. */
  sessionId?: string;
  maxSteps?: number;
  configService?: ConfigService;
  /** Assembly overrides, for tests. */
  runtime?: Partial<RuntimeOptions>;
}

/**
 * An ACP session is a runtime like any other surface's: the same provider, tools,
 * policy, and session log. It differs only in forwarding approval requests to the editor
 * and rendering events as session updates, which the server does.
 */
export const createAcpSession = async (options: CreateAcpSessionOptions): Promise<AcpSessionController> => {
  const configService = options.configService ?? new ConfigService(options.projectRoot);
  const runtime = await createRuntime({
    projectRoot: options.projectRoot,
    cwd: options.cwd,
    surface: 'acp',
    sessionId: options.sessionId,
    maxSteps: options.maxSteps,
    configService,
    ...options.runtime,
  });
  const config = await configService.getConfig();
  const { provider, model } = runtime.model;

  return {
    id: runtime.sessionId,
    cwd: options.cwd,
    model,
    profile: config.active_profile,
    configOptions: [
      { id: 'model', name: 'Model', category: 'model', currentValue: `${provider}:${model}` },
      { id: 'profile', name: 'Profile', category: 'profile', currentValue: config.active_profile },
    ],
    run: (prompt, onEvent) => runtime.run(prompt, onEvent),
    cancel: () => runtime.cancel(),
    close: () => runtime.close(),
  };
};
