import { useEffect } from 'react';
import type { LayoutContext } from './useLayoutContext.js';

export function useLayoutEffects(ctx: LayoutContext): void {
  const {
    stdout,
    config,
    prevContextEnabledRef,
    showInlineNotice,
    pendingAction,
    inputValue,
    inputValueRef,
    availableModels,
    modelMenuState,
    activeProfile,
    clearModelTokenUsage,
    setAvailableModels,
    prefetchingModelsRef,
    exitResetTimeoutRef,
    exitConfirmation,
    exitConfirmationRef,
    setTerminalSize,
  } = ctx;
  const modelService = ctx.modelServiceRef.current;
  useEffect(() => {
    if (!stdout || !stdout.isTTY) return;
    try {
      stdout.write('\x1b[?2004h');
    } catch {
      // no-op
    }
    return () => {
      try {
        stdout.write('\x1b[?2004l');
      } catch {
        // no-op
      }
    };
  }, [stdout]);

  useEffect(() => {
    const ctxEnabled = config?.context_management?.enabled ?? false;
    const previous = prevContextEnabledRef.current;
    prevContextEnabledRef.current = ctxEnabled;
    const thresholdPct = Math.round(((config?.context_management?.compression_threshold ?? 0.9) * 100));
    const maxTokens = config?.context_management?.max_tokens ?? 8000;

    if (previous === undefined && !ctxEnabled) return;
    if (previous === ctxEnabled) return;

    showInlineNotice({
      message: ctxEnabled
        ? `Context compression on (${thresholdPct}% of ${maxTokens} tokens).`
        : 'Context compression off.',
      tone: 'info',
      kind: 'clear_input',
    });
  }, [config?.context_management, showInlineNotice]);

  useEffect(() => {
    if (!pendingAction) {
      return;
    }

    const description =
      pendingAction.type === 'shell_exec'
        ? pendingAction.params.command
        : pendingAction.type === 'tool_call'
          ? `Call ${pendingAction.params.tool || pendingAction.params.descriptor?.name || 'tool'}`
          : `Edit ${pendingAction.params.path}`;
    showInlineNotice({
      message: `Action pending: ${description} | [1] [Yes] (Enter) [2] [Yes, don't ask again] [3] [No, change something]`,
      tone: 'warning',
      kind: 'sticky',
    });
  }, [pendingAction, showInlineNotice]);

  useEffect(() => {
    inputValueRef.current = inputValue;
  }, [inputValue, availableModels, modelMenuState.models, activeProfile?.preferred_provider]);

  useEffect(() => {
    clearModelTokenUsage();
  }, [clearModelTokenUsage]);

  useEffect(() => {
    const wantsModelSuggestions = inputValue.toLowerCase().startsWith('/model');
    if (!wantsModelSuggestions || availableModels.length > 0 || !modelService || prefetchingModelsRef.current) {
      return;
    }

    prefetchingModelsRef.current = true;
    const loadModels = async () => {
      try {
        const models = await modelService.listAvailableModels();
        setAvailableModels(models);
      } catch {
        // Ignore; user can still open the model menu to see any errors.
      } finally {
        prefetchingModelsRef.current = false;
      }
    };

    void loadModels();
  }, [inputValue, availableModels.length]);

  useEffect(() => {
    return () => {
      if (exitResetTimeoutRef.current) {
        clearTimeout(exitResetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    exitConfirmationRef.current = exitConfirmation;
  }, [exitConfirmation]);

  useEffect(() => {
    if (!stdout) return;

    const handleResize = () => {
      // The terminal rewraps the previous frame on resize, so Ink's line-count
      // erase misses rows and leaves stale frames behind. Clear the screen and
      // home the cursor so the next render starts clean.
      stdout.write('\x1b[2J\x1b[H');
      setTerminalSize({
        rows: stdout.rows ?? 24,
        columns: stdout.columns ?? 80,
      });
    };

    stdout.on('resize', handleResize);
    return () => {
      if (typeof stdout.off === 'function') {
        stdout.off('resize', handleResize);
      } else {
        stdout.removeListener('resize', handleResize);
      }
    };
  }, [stdout]);

  useEffect(() => {
    if (stdout) {
      setTerminalSize({
        rows: stdout.rows ?? 24,
        columns: stdout.columns ?? 80,
      });
    }
  }, [stdout]);
}
