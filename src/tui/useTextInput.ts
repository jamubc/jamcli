import { useCallback } from 'react';
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  normalizePastedContent,
} from './layoutState.js';
import type { CollapsedPastePreview } from './layoutState.js';
import type { InlineNotice } from './useInlineNotice.js';

export type UseTextInputOptions = {
  collapsedPaste: CollapsedPastePreview | null;
  inputValueRef: { current: string };
  pasteBufferRef: { current: { active: boolean; data: string } };
  pasteCounterRef: { current: number };
  terminalSize: { columns?: number };
  setInputValue: (value: string) => void;
  setCollapsedPaste: (value: CollapsedPastePreview | null) => void;
  showInlineNotice: (notice: InlineNotice) => void;
};

export function useTextInput({
  collapsedPaste,
  inputValueRef,
  pasteBufferRef,
  pasteCounterRef,
  terminalSize,
  setInputValue,
  setCollapsedPaste,
  showInlineNotice,
}: UseTextInputOptions) {
  const handleTextInputChange = useCallback(
    (nextValue: string) => {
      const previousValue = inputValueRef.current;
      const hasStart = nextValue.includes(BRACKETED_PASTE_START);
      const hasEnd = nextValue.includes(BRACKETED_PASTE_END);
      const isCapturing = pasteBufferRef.current.active || hasStart || hasEnd;

      const processPaste = (normalized: string) => {
        if (!normalized.length) {
          setCollapsedPaste(null);
          setInputValue('');
          return;
        }

        const lineCount = normalized.split('\n').length;
        const width = terminalSize.columns ?? 80;
        const shouldCollapse =
          previousValue.length === 0 && (lineCount > 1 || normalized.length >= Math.max(width - 6, 80));

        if (shouldCollapse) {
          const nextId = pasteCounterRef.current + 1;
          pasteCounterRef.current = nextId;
          setCollapsedPaste({
            id: nextId,
            content: normalized,
            lineCount,
            charCount: normalized.length,
          });
          showInlineNotice({
            message: `Pasted ${lineCount} lines (${normalized.length} chars). Enter inserts · Esc cancels.`,
            tone: 'info',
            kind: 'clear_input',
          });
          setInputValue('');
        } else {
          setCollapsedPaste(null);
          setInputValue(normalized);
        }
      };

      if (isCapturing) {
        let chunk = nextValue;

        if (hasStart) {
          pasteBufferRef.current.active = true;
          pasteBufferRef.current.data = '';
          chunk = chunk.split(BRACKETED_PASTE_START).join('');
        }

        if (hasEnd) {
          const beforeEnd = chunk.split(BRACKETED_PASTE_END)[0] || '';
          pasteBufferRef.current.data += beforeEnd;
          const normalized = normalizePastedContent(pasteBufferRef.current.data);
          pasteBufferRef.current = { active: false, data: '' };
          processPaste(normalized);
          return;
        }

        if (pasteBufferRef.current.active) {
          pasteBufferRef.current.data += chunk;
          return;
        }
      }

      if (collapsedPaste) {
        setCollapsedPaste(null);
      }

      setInputValue(nextValue);
    },
    [collapsedPaste, showInlineNotice, terminalSize.columns]
  );

  return handleTextInputChange;
}
