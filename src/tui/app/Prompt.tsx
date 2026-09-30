/** @jsxImportSource @opentui/react */
import type { SyntaxStyle } from '@opentui/core';
import { useState } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { PendingApproval } from '../state/view.js';
import { ListRow } from './ListRow.js';
import { useClickable } from './mouse.js';
import { DiffView } from './Rows.js';
import { diffRows } from './format.js';
import { framed, usePlain, useSelectable, useTheme } from './theme.js';

/** An input's submitted text: OpenTUI's React input hands over the value itself. */
const submitted = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * A command preview without the command the heading already shows whole: what is left
 * are its facts, such as where it runs. A command the heading has to cut is kept.
 */
export const omitRepeated = (preview: string, heading: string, room: number): string => {
  const [command, ...facts] = preview.split('\n');
  const repeated = !command.includes('\n') && heading.includes(command) && heading.length <= room;
  return repeated ? facts.join('\n') : preview;
};

/**
 * Rows the transcript keeps while a prompt is up, so the model's words before the call
 * stay in view beside the choice. The prompt's preview takes what is left.
 */
const TRANSCRIPT_ROWS_KEPT = 8;

/** The header and the status line. */
const CHROME_ROWS = 2;

/** The prompt's rows besides the preview: borders, heading, reason, spacer, and five choices. */
const FIXED_ROWS = 10;

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
  escaping?: boolean;
  onFeedback: (text: string) => void;
  /** A choice selection: 1 to 5 */
  onChoose?: (key: Choice) => void;
}) {
  const { approval, queued, syntax, file, selected, feedback, escaping } = props;
  const theme = useTheme();
  const sel = useSelectable();
  const clickable = useClickable();
  const plain = usePlain();
  const { width: columns, height } = useTerminalDimensions();
  const previewRows = Math.max(MIN_PREVIEW_ROWS, height - CHROME_ROWS - TRANSCRIPT_ROWS_KEPT - FIXED_ROWS);
  const room = Math.max(20, columns - 4);
  const [hovered, setHovered] = useState<Choice | undefined>(undefined);
  const choice = (key: Choice) => clickable(() => props.onChoose?.(key), { over: () => setHovered(key), out: () => setHovered((now) => (now === key ? undefined : now)) });

  const diff = approval.preview?.kind === 'diff' ? approval.preview.text : undefined;
  const diffHeight = diff ? (plain ? diff.split('\n').length + 1 : diffRows(diff)) : 0;
  const diffOverflow = diffHeight > previewRows;
  const asker = approval.from;
  const heading = plain
    ? `Permission needed: ${asker ? `${asker.title}, agent ${asker.agent}, asks: ` : ''}Allow ${approval.summary}?`
    : `${asker ? `${asker.title} · ${asker.agent} › ` : ''}Allow ${approval.summary}?`;

  const indent = plain ? 0 : 2;
  const commandOnce = !plain && approval.preview?.kind === 'command' ? omitRepeated(approval.preview.text, heading, room) : undefined;
  const text = commandOnce !== undefined ? commandOnce || undefined : approval.preview && approval.preview.kind !== 'diff' ? approval.preview.text : undefined;
  const textRows = text ? text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / Math.max(1, room - indent))), 0) : 0;
  const textOverflow = textRows > previewRows;
  const waiting = `${asker ? (plain ? 'o looks in on it, ' : 'o look in · ') : ''}${queued > 1 ? `1 of ${queued} waiting · ` : ''}`;
  const badge = plain ? 'Escape denies and stops' : '[Esc]';
  const reason = approval.reason.charAt(0).toUpperCase() + approval.reason.slice(1);

  const pattern = approval.suggestions[selected];
  const patterns = approval.suggestions.length;
  const label = (key: Choice, what: string, detail?: string) => (
    <ListRow chosen={hovered === key} mark={plain ? `${key}: ` : ` ${key}  `} markFg={theme.accent} label={what} {...(detail ? { detail } : {})} fg={theme.text} detailFg={theme.dim} {...choice(key)} />
  );
  // Which of the patterns is offered, on the row that grants it, since Up and Down change it there.
  const counted = patterns > 1 ? `${pattern}   ${plain ? `pattern ${selected + 1} of ${patterns}, Up and Down change it` : `▲▼ ${selected + 1}/${patterns}`}` : pattern;
  // A change to files is framed in the accent; anything that runs, reaches out, or delegates in the warning color.
  const frame = approval.policyClass === 'write' ? theme.accent : theme.warn;

  return (
    <box {...framed(plain, frame)} flexDirection="column" flexShrink={0}>
      {/* A screen reader reads the heading whole, then the keys, rather than the two interleaved across a wrap. */}
      <box flexDirection={plain ? 'column' : 'row'} justifyContent={plain ? 'flex-start' : 'space-between'}>
        <text {...sel} fg={theme.warn} {...(text && !plain ? { wrapMode: 'none' as const, truncate: true } : {})}>{heading}</text>
        <text {...sel} flexShrink={0} marginLeft={plain ? 0 : 1}>
          {waiting ? <span fg={theme.dim}>{waiting}</span> : null}
          <span fg={escaping ? theme.error : theme.dim}>{plain ? `${badge}${escaping ? ' (denying)' : ''}` : `[${escaping ? '✕ Esc' : 'Esc'}]`}</span>
        </text>
      </box>
      {diff && diffOverflow ? (
        <scrollbox height={previewRows} flexShrink={0} verticalScrollbarOptions={{ visible: false }}>
          <DiffView diff={diff} file={file} syntax={syntax} />
        </scrollbox>
      ) : diff ? (
        <DiffView diff={diff} file={file} syntax={syntax} />
      ) : null}
      {diffOverflow ? <text {...sel} fg={theme.dim}>{plain ? 'The diff continues.' : '… the diff continues, [↕ scroll]'}</text> : null}
      {text ? (
        <scrollbox
          height={Math.min(textRows, previewRows)}
          flexShrink={0}
          paddingLeft={plain ? 0 : 1}
          verticalScrollbarOptions={{ visible: false }}
          {...(plain ? {} : { border: ['left'] as const, borderColor: theme.dim })}
        >
          <text {...sel} fg={theme.tokens.raw ?? theme.text} wrapMode="char">
            {text}
          </text>
        </scrollbox>
      ) : null}
      {textOverflow ? <text {...sel} fg={theme.dim}>{plain ? 'The command continues.' : `… ${textRows - previewRows} more ${textRows - previewRows === 1 ? 'row' : 'rows'}, [↕ scroll]`}</text> : null}
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
          {pattern ? label('2', 'Allow this session', counted) : null}
          {pattern ? label('3', 'Allow this project', `${patterns > 1 ? 'the same rule' : pattern} · .jamcli/config.local.json`) : null}
          {label('4', 'Deny, continue')}
          {label('5', 'Deny with feedback')}
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
