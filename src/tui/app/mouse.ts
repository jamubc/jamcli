import type { MouseEvent } from '@opentui/core';
import { useRenderer } from '@opentui/react';

/**
 * A handler for a mouse-up that acts only on a click: a press released where a drag has
 * selected text is the end of a selection, which copies, and never also chooses.
 */
export function useClick(): (act: () => void) => () => void {
  const renderer = useRenderer();
  return (act) => () => {
    if (renderer.getSelection()?.getSelectedText()) return;
    act();
  };
}

/** The rows one turn of the wheel moves a list: down is forward, up is back. */
export function wheelStep(event: MouseEvent): number {
  const direction = event.scroll?.direction;
  return direction === 'down' ? 1 : direction === 'up' ? -1 : 0;
}
