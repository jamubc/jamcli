/** @jsxImportSource @opentui/react */
import type { Clickable } from './mouse.js';
import { chosenRow, useSelectable, useTheme, type Color } from './theme.js';

/** A mark, a label, and a detail on one flex row; `labelWidth` aligns the details in a column. */
export function ListRow(props: { chosen: boolean; mark: string; label: string; detail?: string; labelWidth?: number; fg: Color; markFg?: Color; detailFg?: Color } & Clickable) {
  const theme = useTheme();
  const sel = useSelectable();
  const { bg, attributes } = chosenRow(theme, props.chosen);
  const cut = { wrapMode: 'none' as const, truncate: true, ...(attributes !== undefined ? { attributes } : {}) };
  return (
    <box flexDirection="row" width="100%" {...(bg !== undefined ? { backgroundColor: bg } : {})} onMouseUp={props.onMouseUp} onMouseOver={props.onMouseOver} onMouseOut={props.onMouseOut}>
      <text {...sel} {...cut} flexShrink={0} fg={props.markFg ?? props.fg}>{props.mark}</text>
      <text {...sel} {...cut} fg={props.fg} flexShrink={0} {...(props.labelWidth !== undefined ? { minWidth: props.labelWidth } : {})}>{props.label}</text>
      {props.detail ? <text {...sel} {...cut} flexGrow={1} flexShrink={1} fg={props.detailFg ?? props.fg} {...(props.labelWidth === undefined ? { marginLeft: 3 } : {})}>{props.detail}</text> : null}
    </box>
  );
}
