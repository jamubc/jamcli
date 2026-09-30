/** @jsxImportSource @opentui/react */
import { useEffect, useState } from 'react';
import type { SessionNote } from '../../core/runtime/index.js';
import { wheelStep } from './mouse.js';
import { selectable, type Theme } from './theme.js';

/** How many notes are shown whole before they collapse into one row. */
export const NOTES_SHOWN = 3;

/** A note's time, as the clock on the wall read it. */
export const noteClock = (ts: number): string => {
  const at = new Date(ts);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
};

/**
 * The tester's flags, newest on top, shown while there are any. A flag is a person's
 * remark on this point of the session, for whoever reads it back; the session log keeps
 * it. Past three they collapse into one row, so they never push the conversation off the
 * screen: the wheel over it moves through them one at a time, newest first, hovering shows
 * the one in view whole, and /notes lists them all.
 */
export function NotesPanel({ notes: newestFirst, plain, colors }: { notes: SessionNote[]; plain: boolean; colors: Theme }) {
  const sel = selectable(colors);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);
  // A new note comes into view.
  useEffect(() => setAt(0), [newestFirst.length]);
  if (newestFirst.length > NOTES_SHOWN) {
    const shown = Math.min(at, newestFirst.length - 1);
    const note = newestFirst[shown];
    if (plain) return <text {...sel} flexShrink={0}>{`Tester notes: ${newestFirst.length}. Newest at ${noteClock(note.ts)}: ${note.text}. /notes lists them.`}</text>;
    return (
      <box
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        onMouseScroll={(event) => {
          const step = wheelStep(event);
          if (step) setAt(Math.min(Math.max(0, shown + step), newestFirst.length - 1));
        }}
        onMouseOver={() => setOpen(true)}
        onMouseOut={() => setOpen(false)}
      >
        <text {...sel} wrapMode={open ? 'word' : 'none'} truncate={!open}>
          <span fg={colors.warn}>{'⚑ '}</span>
          <span fg={colors.dim}>{`${shown + 1}/${newestFirst.length} ${noteClock(note.ts)} `}</span>
          <span fg={shown === 0 ? colors.text : colors.dim}>{note.text}</span>
          {open ? null : <span fg={colors.dim}>{' · wheel for more'}</span>}
        </text>
      </box>
    );
  }
  if (plain) {
    return (
      <box flexDirection="column" flexShrink={0}>
        {newestFirst.map((note, index) => (
          <text {...sel} key={newestFirst.length - index}>{`Tester note at ${noteClock(note.ts)}: ${note.text}`}</text>
        ))}
      </box>
    );
  }
  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
      {newestFirst.map((note, index) => (
        <text {...sel} key={newestFirst.length - index} wrapMode="word">
          <span fg={colors.warn}>{'⚑ '}</span>
          <span fg={colors.dim}>{`${noteClock(note.ts)} `}</span>
          <span fg={index === 0 ? colors.text : colors.dim}>{note.text}</span>
        </text>
      ))}
    </box>
  );
}
