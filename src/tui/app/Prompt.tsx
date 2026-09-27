/** @jsxImportSource @opentui/react */
import type { SyntaxStyle } from '@opentui/core';
import { useState } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { PendingApproval } from '../state/view.js';
import { useClick } from './mouse.js';
import { DiffView } from './Rows.js';
import { diffRows } from './format.js';
import { chosenRow, framed, usePlain, useSelectable, useTheme } from './theme.js';

/** An input's submitted text: OpenTUI's React input hands over the value itself. */
const submitted = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A line cut to a width, with an ellipsis where it was cut. */
const fitTo = (line: string, room: number): string => (line.length > room ? `${line.slice(0, Math.max(0, room - 1))}…` : line);

/**
 * Rows the transcript keeps while a prompt is up, so the model's words before the call
 * stay in view beside the choice. The prompt's preview takes what is left.
 */
const TRANSCRIPT_ROWS_KEPT = 8;

/** The header and the status line. */
const CHROME_ROWS = 2;

/** The prompt's rows besides the preview: borders, heading, reason, spacer, five choices, and a hint. */
const FIXED_ROWS = 11;

/** The fewest preview rows worth showing. */
const MIN_PREVIEW_ROWS = 3;

/** The keyed choices. Escape is the sixth: deny and stop the turn. */
type Choice = '1' | '2' | '3' | '4' | '5';

/**
 * The permission prompt, which replaces the composer while a call waits. It reads top
 * to bottom as a decision: what wants to run; why the harness stopped; then the keyed
 * choices, the pattern a grant would remember beside the two that use it. Escape, shown
 * as a badge in the corner, denies and stops the turn; the badge turns red when pressed.
 * A deny can instead let the turn go on, or carry feedback for the model, typed on a
 * line of its own. The choice under the pointer is drawn as a bar, so what a click would
 * answer is plain before the click.
 */
export function PermissionPrompt(props: {
  approval: PendingApproval;
  queued: number;
  syntax: SyntaxStyle;
  file?: string;
  selected: number;
  feedback: boolean;
  /** Escape was pressed: the badge shows red while the answer lands. */
  escaping?: boolean;
  onFeedback: (text: string) => void;
  /** A choice was clicked: 1 to 5, as its key would. */
  onChoose?: (key: Choice) => void;
}) {
  const { approval, queued, syntax, file, selected, feedback, escaping } = props;
  const theme = useTheme();
  const sel = useSelectable();
  const click = useClick();
  const plain = usePlain();
  const { width: columns, height } = useTerminalDimensions();
  const previewRows = Math.max(MIN_PREVIEW_ROWS, height - CHROME_ROWS - TRANSCRIPT_ROWS_KEPT - FIXED_ROWS);
  // The frame takes two columns of border and two of padding.
  const room = Math.max(20, columns - 4);
  const choice = (key: Choice) => click(() => props.onChoose?.(key));
  const [hovered, setHovered] = useState<Choice | undefined>(undefined);

  const diff = approval.preview?.kind === 'diff' ? approval.preview.text : undefined;
  // The rows the diff is drawn in: its hunks, or in screen reader mode every line after a label.
  const diffHeight = diff ? (plain ? diff.split('\n').length + 1 : diffRows(diff)) : 0;
  const diffOverflow = diffHeight > previewRows;
  const text = approval.preview && approval.preview.kind !== 'diff' ? approval.preview.text : undefined;
  // A command is read whole before it is allowed: long lines wrap, and rows past the ones
  // the transcript leaves scroll with the wheel, as a diff does.
  const indent = plain ? 0 : 2;
  const textRows = text ? text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / Math.max(1, room - indent))), 0) : 0;
  const textOverflow = textRows > previewRows;
  // The heading names the call. When the preview carries the whole command, the heading
  // does not repeat it past one line.
  const heading = `${plain ? 'Permission needed: ' : ''}Allow ${approval.summary}?`;
  const waiting = queued > 1 ? `1 of ${queued} waiting · ` : '';
  const badge = plain ? 'Escape denies and stops' : '[Esc]';
  const corner = waiting.length + badge.length + 2;
  const title = text ? fitTo(heading, room - corner) : heading;
  const reason = approval.reason.charAt(0).toUpperCase() + approval.reason.slice(1);

  const pattern = approval.suggestions[selected];
  const patterns = approval.suggestions.length;
  const label = (key: Choice, what: string, detail?: string) => {
    const head = plain ? `${key}: ` : ` ${key}  `;
    const shownDetail = detail ? `   ${fitTo(detail, room - head.length - what.length - 3)}` : '';
    const rest = ' '.repeat(Math.max(0, room - head.length - what.length - shownDetail.length));
    return (
      <text
        {...sel}
        {...chosenRow(theme, hovered === key)}
        width="100%"
        fg={theme.text}
        onMouseUp={choice(key)}
        onMouseOver={() => setHovered(key)}
        onMouseOut={() => setHovered((now) => (now === key ? undefined : now))}
      >
        <span fg={theme.accent}>{head}</span>
        <span>{what}</span>
        {shownDetail ? <span fg={theme.dim}>{shownDetail}</span> : null}
        {rest}
      </text>
    );
  };
  const notes = patterns > 1 ? `Up/Down pattern ${selected + 1}/${patterns}` : '';

  return (
    <box {...framed(plain, theme.warn)} flexDirection="column" flexShrink={0}>
      <box flexDirection="row" justifyContent="space-between">
        <text {...sel} fg={theme.warn}>{title}</text>
        <text {...sel}>
          {waiting ? <span fg={theme.dim}>{waiting}</span> : null}
          <span fg={escaping ? theme.error : theme.dim}>{plain ? `${badge}${escaping ? ' (denying)' : ''}` : `[${escaping ? '✕ Esc' : 'Esc'}]`}</span>
        </text>
      </box>
      {diff && diffOverflow ? (
        // A diff taller than the rows the transcript leaves it scrolls with the wheel inside them.
        <scrollbox height={previewRows} flexShrink={0} verticalScrollbarOptions={{ visible: false }}>
          <DiffView diff={diff} file={file} syntax={syntax} />
        </scrollbox>
      ) : diff ? (
        <DiffView diff={diff} file={file} syntax={syntax} />
      ) : null}
      {diffOverflow ? <text {...sel} fg={theme.dim}>{plain ? 'The diff continues.' : '… the diff continues, wheel scrolls it'}</text> : null}
      {text ? (
        <scrollbox height={Math.min(textRows, previewRows)} flexShrink={0} paddingLeft={indent} verticalScrollbarOptions={{ visible: false }}>
          <text {...sel} fg={theme.tokens.raw ?? theme.text} wrapMode="char">
            {text}
          </text>
        </scrollbox>
      ) : null}
      {textOverflow ? <text {...sel} fg={theme.dim}>{plain ? 'The command continues.' : `… ${textRows - previewRows} more ${textRows - previewRows === 1 ? 'row' : 'rows'}, wheel scrolls it`}</text> : null}
      <text {...sel} fg={theme.dim} wrapMode="word">
        {`${reason}.`}
      </text>
      <text {...sel}> </text>
      {feedback ? (
        <box flexDirection="column">
          <text {...sel} fg={theme.text}>Feedback for the model (Enter alone denies):</text>
          <input focused placeholder="feedback for the model" onSubmit={(value: unknown) => props.onFeedback(submitted(value))} />
        </box>
      ) : (
        <box flexDirection="column">
          {label('1', 'Allow once')}
          {pattern ? label('2', 'Allow this session', pattern) : null}
          {pattern ? label('3', 'Allow this project', `${pattern} · .jamcli/config.local.json`) : null}
          {label('4', 'Deny, continue')}
          {label('5', 'Deny with feedback')}
          {notes ? <text {...sel} fg={theme.dim}>{fitTo(notes, room)}</text> : null}
        </box>
      )}
    </box>
  );
}

/** Asks the person to type yes before bypass mode turns on. */
export function BypassConfirm({ onAnswer }: { onAnswer: (text: string) => void }) {
  const theme = useTheme();
  const sel = useSelectable();
  const plain = usePlain();
  return (
    <box {...framed(plain, theme.error)} flexDirection="column" flexShrink={0}>
      <text {...sel} fg={theme.error}>{`${plain ? 'Confirm: ' : ''}Turn on bypass mode?`}</text>
      <text {...sel} fg={theme.text}>Nothing will ask before it runs: every edit and every command goes ahead, and only deny rules stop a call.</text>
      <text {...sel} fg={theme.text}>Type yes and press Enter to turn it on. Anything else, or Escape, leaves the mode as it is.</text>
      <input focused placeholder="yes" onSubmit={(value: unknown) => onAnswer(submitted(value))} />
    </box>
  );
}
