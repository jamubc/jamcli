import { useCallback, useEffect, useRef, useState } from 'react';

export type InlineNotice = {
  message: string;
  tone?: 'warning' | 'info';
  kind?: 'clear_input' | 'sticky';
};

export function useInlineNotice(inputValue: string) {
  const [inlineNotice, setInlineNotice] = useState<InlineNotice | null>(null);
  const inlineNoticeRef = useRef<InlineNotice | null>(null);

  const showInlineNotice = useCallback((notice: InlineNotice) => {
    inlineNoticeRef.current = notice;
    setInlineNotice(notice);
  }, []);

  const clearInlineNotice = useCallback(() => {
    inlineNoticeRef.current = null;
    setInlineNotice(null);
  }, []);

  useEffect(() => {
    if (!inputValue && inlineNoticeRef.current?.kind === 'clear_input') {
      clearInlineNotice();
    }
  }, [clearInlineNotice, inputValue]);

  return { inlineNotice, showInlineNotice, clearInlineNotice };
}
