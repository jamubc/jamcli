/** @jsxImportSource @opentui/react */
import { useRef } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { useClick, wheelStep } from './mouse.js';
import { chosenRow, framed, usePlain, useSelectable, useTheme } from './theme.js';
import type { ChoiceItem } from '../../commands/types.js';

/** The rows the list shows for a filter: the matching choices, or the typed text first. */
export function shownItems(items: ChoiceItem[], filter: string, freeText?: string): ChoiceItem[] {
  if (freeText === undefined) return filterItems(items, filter);
  return [{ key: '__typed__', label: filter || '(type the answer)', detail: freeText, value: filter }, ...items];
}

/** How many choices the overlay shows at once. */
export const PICKER_ROWS = 10;

/**
 * The first row a list shows: it stays where it was until the selection leaves it, so
 * moving the selection, by key or by wheel, scrolls the list only at its edges.
 */
export function useListWindow(selected: number, count: number, rows: number): number {
  const top = useRef(0);
  let start = top.current;
  if (selected < start) start = selected;
  if (selected >= start + rows) start = selected - rows + 1;
  start = Math.min(Math.max(0, start), Math.max(0, count - rows));
  top.current = start;
  return start;
}

/** The choices that match a filter: every word must appear in the label or the detail. */
export function filterItems(items: ChoiceItem[], filter: string): ChoiceItem[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => {
    const text = `${item.label} ${item.detail ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * An overlay over the composer, laid out like the permission prompt: the title, with the
 * position in a long list and the Escape badge in its corner; the filter the person types
 * into; the matching choices, the chosen one marked with a word as well as a color; then,
 * set apart, anything to know and what the keys do.
 */
export function Picker(props: {
  title: string;
  items: ChoiceItem[] | undefined;
  note?: string;
  empty: string;
  hint?: string;
  filter: string;
  selected: number;
  freeText?: string;
  /** A row was clicked: choose it, as Enter would. The index is among the shown rows. */
  onPick?: (index: number) => void;
  /** The pointer is over a row: mark it chosen. */
  onHover?: (index: number) => void;
  /** The wheel turned over the list: move the selection by this many rows. */
  onScroll?: (step: number) => void;
}) {
  const theme = useTheme();
  const sel = useSelectable();
  const click = useClick();
  const plain = usePlain();
  const { width: columns } = useTerminalDimensions();
  // The frame takes two columns of border and two of padding.
  const room = Math.max(20, columns - 4);
  const fit = (line: string, width = room) => (line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line);
  const shown = props.items ? shownItems(props.items, props.filter, props.freeText) : undefined;
  const start = useListWindow(props.selected, shown?.length ?? 0, PICKER_ROWS);
  const visible = shown?.slice(start, start + PICKER_ROWS) ?? [];
  const width = Math.min(48, Math.max(0, ...visible.map((item) => item.label.length + (item.current ? ' (in use)'.length : 0))));
  const counted = shown && props.items && shown.length !== props.items.length ? ` (${shown.length} of ${props.items.length})` : '';
  const position = shown && shown.length > PICKER_ROWS ? `${props.selected + 1} of ${shown.length} · ` : '';
  const badge = plain ? 'Escape closes' : '[Esc]';
  return (
    <box {...framed(plain, theme.accent)} flexDirection="column" flexShrink={0} onMouseScroll={(event) => wheelStep(event) && props.onScroll?.(wheelStep(event))}>
      <box flexDirection="row" justifyContent="space-between">
        <text {...sel} fg={theme.accent}>{fit(`${props.title}${counted}`, room - position.length - badge.length - 2)}</text>
        <text {...sel} fg={theme.dim}>{`${position}${badge}`}</text>
      </box>
      <text {...sel}>
        <span fg={theme.dim}>Filter: </span>
        {props.filter ? <span fg={theme.text}>{fit(props.filter, room - 'Filter: '.length)}</span> : <span fg={theme.dim}>type to narrow the list</span>}
      </text>
      <text {...sel}> </text>
      {shown === undefined ? <text {...sel} fg={theme.dim}>Asking…</text> : null}
      {shown !== undefined && shown.length === 0 ? <text {...sel} fg={theme.dim}>{fit(props.items?.length ? 'Nothing matches the filter.' : props.empty)}</text> : null}
      {visible.map((item, index) => {
        const chosen = start + index === props.selected;
        const text = `${item.label}${item.current ? ' (in use)' : ''}`;
        // A label longer than the column keeps two spaces before its detail.
        const label = text.length >= width ? `${text}  ` : text.padEnd(width + 2);
        return (
          <text {...sel} key={item.key} width="100%" {...chosenRow(theme, chosen)} fg={chosen ? theme.accent : theme.text} onMouseUp={click(() => props.onPick?.(start + index))} onMouseOver={() => props.onHover?.(start + index)}>
            {fit(`${chosen ? (plain ? 'Chosen: ' : '> ') : '  '}${label}${item.detail ?? ''}`).padEnd(room)}
          </text>
        );
      })}
      <text {...sel}> </text>
      {/* A note can carry the fix, so it wraps rather than being cut. */}
      {props.note ? <text {...sel} fg={theme.warn} wrapMode="word">{props.note}</text> : null}
      <text {...sel} fg={theme.dim}>{fit(`${props.hint ?? 'Enter chooses'} · Up/Down move${plain ? '' : ', or click'}`)}</text>
    </box>
  );
}
