import type { MouseEvent } from '@opentui/core';
import { useRenderer } from '@opentui/react';

/** The handlers a row or a line takes to be clickable. */
export interface Clickable {
  onMouseUp: () => void;
  onMouseOver: () => void;
  onMouseOut: () => void;
}

/** A click that does not end a text selection, and a hand pointer while over the row. */
export function useClickable(): (act: () => void, hover?: { over?: () => void; out?: () => void }) => Clickable {
  const renderer = useRenderer();
  return (act, hover) => ({
    onMouseUp: () => {
      if (renderer.getSelection()?.getSelectedText()) return;
      act();
    },
    onMouseOver: () => {
      renderer.setMousePointer('pointer');
      hover?.over?.();
    },
    onMouseOut: () => {
      renderer.setMousePointer('default');
      hover?.out?.();
    },
  });
}

/** The rows one turn of the wheel moves a list: down is forward, up is back. */
export function wheelStep(event: MouseEvent): number {
  const direction = event.scroll?.direction;
  return direction === 'down' ? 1 : direction === 'up' ? -1 : 0;
}
