import { resolveRoute } from '../routing/resolve.js';
import type { RouteResolution } from '../routing/resolve.js';
import { delegationTranscriptLine } from './bounds.js';
import { runChild } from './spawn.js';
import type { AgentEvent } from '../types.js';
import type { ApiRegistry, CategoryChain, DelegationConfig } from '../../types/config.js';

export interface DelegateOptions {
  command: string;
  args: string[];
  category: string;
  prompt: string;
  cwd: string;
  registry: ApiRegistry | undefined;
  categories: Record<string, CategoryChain> | undefined;
  config?: DelegationConfig;
  depth: number;
  running: number;
  isReachable?: (model: string) => Promise<boolean>;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  onNotice?: (line: string) => void;
}

export interface DelegateOutcome {
  status: 'ok' | 'error' | 'cancelled' | 'refused';
  response: string;
  category: string;
  resolvedModel?: string;
  childSessionId?: string;
  transcriptLine?: string;
  reason?: string;
}

export const delegate = async (options: DelegateOptions): Promise<DelegateOutcome> => {
  const resolution: RouteResolution | null = await resolveRoute({
    registry: options.registry,
    categories: options.categories,
    category: options.category,
    isReachable: options.isReachable,
  });

  if (!resolution) {
    return {
      status: 'refused',
      response: '',
      category: options.category,
      reason: `No category named "${options.category}" is configured.`,
    };
  }

  if (!resolution.model) {
    return {
      status: 'refused',
      response: '',
      category: options.category,
      reason: resolution.notes.join(' '),
    };
  }

  const child = await runChild({
    command: options.command,
    args: [...options.args, '--model', resolution.model],
    prompt: options.prompt,
    cwd: options.cwd,
    signal: options.signal,
    onEvent: options.onEvent,
    onNotice: options.onNotice,
  });

  const transcriptLine = delegationTranscriptLine({
    category: options.category,
    resolvedModel: resolution.model,
    childSessionId: child.sessionId ?? 'unknown',
    status: child.status,
  });
  options.onNotice?.(transcriptLine);

  return {
    status: child.status,
    response: child.response,
    category: options.category,
    resolvedModel: resolution.model,
    childSessionId: child.sessionId,
    transcriptLine,
    reason: child.status === 'error' ? child.stderr.trim() || undefined : undefined,
  };
};
