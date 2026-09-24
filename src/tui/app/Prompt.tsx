/** @jsxImportSource @opentui/react */
import type { SyntaxStyle } from '@opentui/core';
import type { PendingApproval } from '../state/view.js';
import { DiffView } from './Rows.js';
import { useTheme } from './theme.js';

/** An input's submitted text: OpenTUI's React input hands over the value itself. */
const submitted = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The permission prompt, which replaces the composer while a call waits: the action, its
 * preview, why it asked, and the four choices of D6. A deny can carry feedback for the
 * model, typed on a line of its own.
 */
export function PermissionPrompt(props: {
  approval: PendingApproval;
  queued: number;
  syntax: SyntaxStyle;
  file?: string;
  selected: number;
  feedback: boolean;
  onFeedback: (text: string) => void;
}) {
  const { approval, queued, syntax, file, selected, feedback } = props;
  const theme = useTheme();
  const preview = approval.preview?.kind === 'diff' ? undefined : approval.preview?.text.split('\n').slice(0, 12).join('\n');
  const pattern = approval.suggestions[selected];
  const others = approval.suggestions.length > 1 ? ` (${selected + 1} of ${approval.suggestions.length}; Up and Down choose)` : '';
  return (
    <box border borderColor={theme.warn} flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
      <text fg={theme.warn}>{`Allow ${approval.summary}?${queued > 1 ? ` (1 of ${queued} waiting)` : ''}`}</text>
      <text fg={theme.dim}>{`Asked because ${approval.reason}.`}</text>
      {approval.preview?.kind === 'diff' ? <DiffView diff={approval.preview.text} file={file} syntax={syntax} /> : null}
      {preview ? <text>{preview}</text> : null}
      {feedback ? (
        <box flexDirection="column">
          <text>Tell the model what to do instead, or press Enter to just deny:</text>
          <input focused placeholder="feedback for the model" onSubmit={(value: unknown) => props.onFeedback(submitted(value))} />
        </box>
      ) : (
        <box flexDirection="column">
          <text>1 allow once</text>
          {pattern ? <text>{`2 allow ${pattern} for this session${others}`}</text> : null}
          {pattern ? <text>{`3 allow ${pattern} for this project, saved in .jamcli/config.local.json`}</text> : null}
          <text>4 deny, and say why · Escape denies</text>
        </box>
      )}
    </box>
  );
}

/** Asks the person to type yes before bypass mode turns on. */
export function BypassConfirm({ onAnswer }: { onAnswer: (text: string) => void }) {
  const theme = useTheme();
  return (
    <box border borderColor={theme.error} flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
      <text fg={theme.error}>Turn on bypass mode?</text>
      <text>Nothing will ask before it runs: every edit and every command goes ahead, and only deny rules stop a call.</text>
      <text>Type yes and press Enter to turn it on. Anything else, or Escape, leaves the mode as it is.</text>
      <input focused placeholder="yes" onSubmit={(value: unknown) => onAnswer(submitted(value))} />
    </box>
  );
}
