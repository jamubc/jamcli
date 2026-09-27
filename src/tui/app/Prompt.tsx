/** @jsxImportSource @opentui/react */
import type { SyntaxStyle } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/react';
import type { PendingApproval } from '../state/view.js';
import { useClick } from './mouse.js';
import { DiffView } from './Rows.js';
import { framed, usePlain, useTheme } from './theme.js';

/** An input's submitted text: OpenTUI's React input hands over the value itself. */
const submitted = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A line cut to a width, with an ellipsis where it was cut. */
const fitTo = (line: string, room: number): string => (line.length > room ? `${line.slice(0, Math.max(0, room - 1))}…` : line);

/** The most lines of a command the prompt shows. */
const PREVIEW_LINES = 12;

/** The keyed choices. Escape is the fifth: deny and stop the turn. */
type Choice = '1' | '2' | '3' | '4';

/**
 * The permission prompt, which replaces the composer while a call waits. It reads top
 * to bottom as a decision: what wants to run; why the harness stopped; then the keyed
 * choices, the pattern a grant would remember beside the two that use it. Escape, shown
 * as a badge in the corner, denies and stops the turn; the badge turns red when pressed.
 * A deny can instead carry feedback for the model, typed on a line of its own.
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
  /** A choice was clicked: 1 to 4, as its key would. */
  onChoose?: (key: Choice) => void;
}) {
  const { approval, queued, syntax, file, selected, feedback, escaping } = props;
  const theme = useTheme();
  const click = useClick();
  const plain = usePlain();
  const { width: columns } = useTerminalDimensions();
  // The frame takes two columns of border and two of padding.
  const room = Math.max(20, columns - 4);
  const choice = (key: Choice) => click(() => props.onChoose?.(key));

  const diff = approval.preview?.kind === 'diff' ? approval.preview.text : undefined;
  const text = approval.preview && approval.preview.kind !== 'diff' ? approval.preview.text : undefined;
  const lines = text ? text.split('\n') : [];
  const shown = lines.slice(0, PREVIEW_LINES);
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
    return (
      <text fg={theme.text} onMouseUp={choice(key)}>
        <span fg={theme.accent}>{head}</span>
        <span>{what}</span>
        {shownDetail ? <span fg={theme.dim}>{shownDetail}</span> : null}
      </text>
    );
  };
  const notes = patterns > 1 ? `Up/Down pattern ${selected + 1}/${patterns}` : '';

  return (
    <box {...framed(plain, theme.warn)} flexDirection="column" flexShrink={0}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.warn}>{title}</text>
        <text>
          {waiting ? <span fg={theme.dim}>{waiting}</span> : null}
          <span fg={escaping ? theme.error : theme.dim}>{plain ? `${badge}${escaping ? ' (denying)' : ''}` : `[${escaping ? '✕ Esc' : 'Esc'}]`}</span>
        </text>
      </box>
      {diff ? <DiffView diff={diff} file={file} syntax={syntax} /> : null}
      {shown.length ? (
        <box flexDirection="column" paddingLeft={plain ? 0 : 2}>
          {shown.map((line, index) => (
            <text key={index} fg={theme.tokens.raw ?? theme.text}>
              {fitTo(line, room - 2)}
            </text>
          ))}
        </box>
      ) : null}
      <text fg={theme.dim} wrapMode="word">
        {`${reason}.`}
      </text>
      <text> </text>
      {feedback ? (
        <box flexDirection="column">
          <text fg={theme.text}>Feedback for the model (Enter alone denies):</text>
          <input focused placeholder="feedback for the model" onSubmit={(value: unknown) => props.onFeedback(submitted(value))} />
        </box>
      ) : (
        <box flexDirection="column">
          {label('1', 'Allow once')}
          {pattern ? label('2', 'Allow this session', pattern) : null}
          {pattern ? label('3', 'Allow this project', `${pattern} · .jamcli/config.local.json`) : null}
          {label('4', 'Deny with feedback')}
          {notes ? <text fg={theme.dim}>{fitTo(notes, room)}</text> : null}
        </box>
      )}
    </box>
  );
}

/** Asks the person to type yes before bypass mode turns on. */
export function BypassConfirm({ onAnswer }: { onAnswer: (text: string) => void }) {
  const theme = useTheme();
  const plain = usePlain();
  return (
    <box {...framed(plain, theme.error)} flexDirection="column" flexShrink={0}>
      <text fg={theme.error}>{`${plain ? 'Confirm: ' : ''}Turn on bypass mode?`}</text>
      <text fg={theme.text}>Nothing will ask before it runs: every edit and every command goes ahead, and only deny rules stop a call.</text>
      <text fg={theme.text}>Type yes and press Enter to turn it on. Anything else, or Escape, leaves the mode as it is.</text>
      <input focused placeholder="yes" onSubmit={(value: unknown) => onAnswer(submitted(value))} />
    </box>
  );
}
