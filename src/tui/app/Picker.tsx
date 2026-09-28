/** @jsxImportSource @opentui/react */
import { useRef } from 'react';
import { ListRow } from './ListRow.js';
import { useClickable, wheelStep } from './mouse.js';
import { framed, usePlain, useSelectable, useTheme } from './theme.js';
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
  const clickable = useClickable();
  const plain = usePlain();
  const cut = { wrapMode: 'none' as const, truncate: true };
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
        <text {...sel} {...cut} fg={theme.accent}>{`${props.title}${counted}`}</text>
        <text {...sel} {...cut} flexShrink={0} marginLeft={1} fg={theme.dim}>{`${position}${badge}`}</text>
      </box>
      <text {...sel} {...cut}>
        <span fg={theme.dim}>Filter: </span>
        {props.filter ? <span fg={theme.text}>{props.filter}</span> : <span fg={theme.dim}>type to narrow the list</span>}
      </text>
      <text {...sel}> </text>
      {shown === undefined ? <text {...sel} fg={theme.dim}>Asking…</text> : null}
      {shown !== undefined && shown.length === 0 ? <text {...sel} fg={theme.dim}>{props.items?.length ? 'Nothing matches the filter.' : props.empty}</text> : null}
      {visible.map((item, index) => {
        const chosen = start + index === props.selected;
        return (
          <ListRow
            key={item.key}
            chosen={chosen}
            mark={chosen ? (plain ? 'Chosen: ' : '> ') : '  '}
            label={`${item.label}${item.current ? ' (in use)' : ''}`}
            labelWidth={width + 2}
            {...(item.detail ? { detail: item.detail } : {})}
            fg={chosen ? theme.accent : theme.text}
            {...clickable(() => props.onPick?.(start + index), { over: () => props.onHover?.(start + index) })}
          />
        );
      })}
      <text {...sel}> </text>
      {/* A note can carry the fix, so it wraps rather than being cut. */}
      {props.note ? <text {...sel} fg={theme.warn} wrapMode="word">{props.note}</text> : null}
      <text {...sel} {...cut} fg={theme.dim}>{`${props.hint ?? 'Enter chooses'} · Up/Down move${plain ? '' : ', or click'}`}</text>
    </box>
  );
}
