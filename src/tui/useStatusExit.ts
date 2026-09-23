import { useCallback, useEffect } from 'react';
import { STREAMING_STATUS_LINES, THINKING_STATUS_LINES } from './layoutState.js';
import type { Profile } from '../types/config.js';
import type { Message, TokenUsage } from '../core/types.js';

interface StatusDeps {
  status: 'idle' | 'thinking' | 'streaming';
  activeProfile: Profile | null;
  statusLineIndexRef: { current: number };
  setStatusDetail: (detail: { phase: 'thinking' | 'streaming'; modelName: string; startedAt: number; message: string } | null) => void;
  recentModelsRef: { current: string[] };
  modelsUsedRef: { current: Set<string> };
  initializeModelTokenUsage: (key: string) => void;
}

export function useStatusTracking({
  status,
  activeProfile,
  statusLineIndexRef,
  setStatusDetail,
  recentModelsRef,
  modelsUsedRef,
  initializeModelTokenUsage,
}: StatusDeps) {
  const pickStatusLine = useCallback(
    (phase: 'thinking' | 'streaming') => {
      const options = phase === 'thinking' ? THINKING_STATUS_LINES : STREAMING_STATUS_LINES;
      const idx = statusLineIndexRef.current % options.length;
      statusLineIndexRef.current += 1;
      return options[idx];
    },
    [statusLineIndexRef]
  );

  const recordModelUsage = useCallback((provider: string, model: string) => {
    if (!provider || !model) return;
    const id = `${provider}:${model}`;
    recentModelsRef.current = [id, ...recentModelsRef.current.filter((item) => item !== id)].slice(0, 25);
    modelsUsedRef.current.add(id);
  }, [recentModelsRef, modelsUsedRef]);

  useEffect(() => {
    if (activeProfile?.preferred_model) {
      const provider = activeProfile.preferred_provider || 'ollama';
      const key = `${provider}:${activeProfile.preferred_model}`;
      recordModelUsage(provider, activeProfile.preferred_model);
      initializeModelTokenUsage(key);
    }
  }, [activeProfile?.preferred_model, activeProfile?.preferred_provider, initializeModelTokenUsage, recordModelUsage]);

  useEffect(() => {
    if (status === 'idle') {
      setStatusDetail(null);
      return;
    }

    const phase: 'thinking' | 'streaming' = status === 'streaming' ? 'streaming' : 'thinking';
    setStatusDetail({
      phase,
      modelName: activeProfile?.preferred_model || 'Model',
      startedAt: Date.now(),
      message: pickStatusLine(phase),
    });
  }, [activeProfile?.preferred_model, pickStatusLine, status, setStatusDetail]);

  return { pickStatusLine, recordModelUsage };
}

interface ExitDeps {
  status: 'idle' | 'thinking' | 'streaming';
  activeProfile: Profile | null;
  messages: Message[];
  modelTokenUsage: Record<string, TokenUsage>;
  modelsUsedRef: { current: Set<string> };
  sessionStartRef: { current: number };
  abortControllerRef: { current: AbortController | null };
  cancelReasonRef: { current: 'escape' | 'ctrl+c' | null };
  exitResetTimeoutRef: { current: ReturnType<typeof setTimeout> | null };
  exitConfirmationRef: { current: boolean };
  setExitConfirmation: (value: boolean) => void;
  getSessionUsage: () => { promptTokens: number; completionTokens: number } | null;
  exit: () => void;
}

export function useExitHandling({
  status,
  activeProfile,
  messages,
  modelTokenUsage,
  modelsUsedRef,
  sessionStartRef,
  abortControllerRef,
  cancelReasonRef,
  exitResetTimeoutRef,
  exitConfirmationRef,
  setExitConfirmation,
  getSessionUsage,
  exit,
}: ExitDeps) {
  const cancelCurrentRequest = (reason: 'escape' | 'ctrl+c') => {
    if (!abortControllerRef.current) return false;
    cancelReasonRef.current = reason;
    abortControllerRef.current.abort();
    return true;
  };

  const clearExitConfirmation = useCallback(() => {
    if (exitResetTimeoutRef.current) {
      clearTimeout(exitResetTimeoutRef.current);
      exitResetTimeoutRef.current = null;
    }
    exitConfirmationRef.current = false;
    setExitConfirmation(false);
  }, [exitResetTimeoutRef, exitConfirmationRef, setExitConfirmation]);

  const requestExitConfirmation = useCallback(() => {
    if (exitResetTimeoutRef.current) {
      clearTimeout(exitResetTimeoutRef.current);
    }
    exitConfirmationRef.current = true;
    setExitConfirmation(true);
    exitResetTimeoutRef.current = setTimeout(() => {
      exitConfirmationRef.current = false;
      setExitConfirmation(false);
      exitResetTimeoutRef.current = null;
    }, 3000);
  }, [exitResetTimeoutRef, exitConfirmationRef, setExitConfirmation]);

  const formatDuration = useCallback((ms: number) => {
    if (ms <= 0) return '0s';
    const totalSeconds = Math.max(1, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts: string[] = [];
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
  }, []);

  const estimateTokens = useCallback((text: string) => {
    if (!text) return 0;
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return Math.max(1, Math.ceil(trimmed.length / 4));
  }, []);

  const buildSessionSummary = useCallback(() => {
    const durationMs = Date.now() - sessionStartRef.current;
    let promptTokens = 0;
    let completionTokens = 0;
    let userMessages = 0;
    let assistantMessages = 0;

    const sessionUsage = getSessionUsage();

    if (sessionUsage) {
      promptTokens = sessionUsage.promptTokens;
      completionTokens = sessionUsage.completionTokens;
    } else {
      messages.forEach((message) => {
        const tokens = estimateTokens(message.content || '');
        if (message.role === 'assistant') {
          completionTokens += tokens;
          assistantMessages += 1;
        } else {
          promptTokens += tokens;
          if (message.role === 'user') {
            userMessages += 1;
          }
        }
      });
    }

    messages.forEach((message) => {
      if (message.role === 'assistant') assistantMessages += 1;
      if (message.role === 'user') userMessages += 1;
    });

    const totalTokens = promptTokens + completionTokens;
    const modelKeys = new Set(modelsUsedRef.current);
    Object.keys(modelTokenUsage).forEach((key) => modelKeys.add(key));
    const modelUsageLines = modelKeys.size
      ? Array.from(modelKeys).map((key) => {
          const usage = modelTokenUsage[key];
          if (usage) {
            return `- ${key}: ${usage.total_tokens} tokens (prompt ${usage.prompt_tokens} · completion ${usage.completion_tokens})`;
          }
          return `- ${key}: 0 tokens recorded`;
        })
      : ['- n/a'];

    const sessionTokensLine = sessionUsage
      ? `Session tokens: ${totalTokens} (prompt ${promptTokens} · completion ${completionTokens})`
      : `Approx tokens: ${totalTokens} (prompt ${promptTokens} · completion ${completionTokens})`;

    return [
      '~goodbye 👋',
      `Session length: ${formatDuration(durationMs)}`,
      `Messages sent: ${userMessages} • Assistant replies: ${assistantMessages}`,
      'Model usage:',
      ...modelUsageLines,
      sessionTokensLine,
    ].join('\n');
  }, [activeProfile?.preferred_model, activeProfile?.preferred_provider, estimateTokens, formatDuration, messages, getSessionUsage, modelTokenUsage, modelsUsedRef, sessionStartRef]);

  const performExit = useCallback(() => {
    clearExitConfirmation();
    const summary = buildSessionSummary();
    exit();

    setTimeout(() => {
      process.stdout.write(`${summary}\n`);
      process.exit(0);
    }, 50);
  }, [buildSessionSummary, clearExitConfirmation, exit]);

  const handleCtrlC = useCallback(() => {
    const isProcessing = status === 'thinking' || status === 'streaming';
    if (isProcessing) {
      cancelCurrentRequest('ctrl+c');
      clearExitConfirmation();
      return;
    }

    if (exitConfirmationRef.current) {
      performExit();
      return;
    }

    requestExitConfirmation();
  }, [status, exitConfirmationRef, performExit, requestExitConfirmation, clearExitConfirmation, abortControllerRef, cancelReasonRef]);

  useEffect(() => {
    const onSigint = () => {
      handleCtrlC();
    };

    process.on('SIGINT', onSigint);
    return () => {
      process.off('SIGINT', onSigint);
    };
  }, [handleCtrlC]);

  return { cancelCurrentRequest, clearExitConfirmation, requestExitConfirmation, performExit, handleCtrlC };
}
