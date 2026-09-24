/** @jsxImportSource @opentui/react */
import { useTerminalDimensions } from '@opentui/react';
import { framed, usePlain, useTheme } from './theme.js';

/** One choice in an overlay. */
export interface PickItem {
  key: string;
  label: string;
  /** A second column: facts about the choice. */
  detail?: string;
  /** The choice in effect now, marked as such. */
  current?: boolean;
  /** What choosing it gives, when that is more than the label shows. */
  value?: string;
}

/** What a command asks the interface to show: a list to choose from, filtered as the person types. */
export interface PickRequest {
  title: string;
  /** The choices, or a promise of them while they are fetched. */
  items: PickItem[] | Promise<{ items: PickItem[]; note?: string }>;
  /** Said when there is nothing to choose. */
  empty: string;
  /** A line under the list, such as what Enter does. */
  hint?: string;
  /** A line above the hint: something to know, such as a provider that could not be asked. */
  note?: string;
  choose(item: PickItem): void | Promise<void>;
}

/** How many choices the overlay shows at once. */
export const PICKER_ROWS = 10;

/** The choices that match a filter: every word must appear in the label or the detail. */
export function filterItems(items: PickItem[], filter: string): PickItem[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => {
    const text = `${item.label} ${item.detail ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * An overlay over the composer: a title, a filter the person types into, and the
 * matching choices, the chosen one marked with a word as well as a color.
 */
export function Picker(props: { title: string; items: PickItem[] | undefined; note?: string; empty: string; hint?: string; filter: string; selected: number }) {
  const theme = useTheme();
  const plain = usePlain();
  const { width: columns } = useTerminalDimensions();
  const room = Math.max(20, columns - 4);
  const fit = (line: string) => (line.length > room ? `${line.slice(0, room - 1)}…` : line);
  const shown = props.items ? filterItems(props.items, props.filter) : undefined;
  const start = shown ? Math.min(Math.max(0, props.selected - PICKER_ROWS + 1), Math.max(0, shown.length - PICKER_ROWS)) : 0;
  const visible = shown?.slice(start, start + PICKER_ROWS) ?? [];
  const width = Math.min(48, Math.max(0, ...visible.map((item) => item.label.length + (item.current ? ' (in use)'.length : 0))));
  return (
    <box {...framed(plain, theme.accent)} flexDirection="column" flexShrink={0}>
      <text fg={theme.accent}>{fit(`${props.title}${shown && props.items && shown.length !== props.items.length ? ` (${shown.length} of ${props.items.length})` : ''}`)}</text>
      <text fg={theme.dim}>{fit(`Filter: ${props.filter}${props.filter ? '' : '(type to narrow the list)'}`)}</text>
      {shown === undefined ? <text fg={theme.dim}>Asking…</text> : null}
      {shown !== undefined && shown.length === 0 ? <text fg={theme.dim}>{fit(props.items?.length ? 'Nothing matches the filter.' : props.empty)}</text> : null}
      {visible.map((item, index) => {
        const chosen = start + index === props.selected;
        const text = `${item.label}${item.current ? ' (in use)' : ''}`;
        // A label longer than the column keeps two spaces before its detail.
        const label = text.length >= width ? `${text}  ` : text.padEnd(width + 2);
        return (
          <text key={item.key} fg={chosen ? theme.accent : undefined}>
            {fit(`${chosen ? (plain ? 'Chosen: ' : '> ') : '  '}${label}${item.detail ?? ''}`)}
          </text>
        );
      })}
      {props.note ? <text fg={theme.warn}>{fit(props.note)}</text> : null}
      <text fg={theme.dim}>{fit(`${shown && shown.length > PICKER_ROWS ? `${props.selected + 1} of ${shown.length} · ` : ''}${props.hint ?? 'Enter chooses'} · Up and Down move · Escape closes`)}</text>
    </box>
  );
}
