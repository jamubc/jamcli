import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

export interface SlashCommand {
  name: string;
  description: string;
}

type StatusDetail = {
  phase: 'thinking' | 'streaming';
  modelName?: string;
  message: string;
  startedAt: number;
};

interface InputBarProps {
  value: string;
  status: 'idle' | 'thinking' | 'streaming';
  statusDetail?: StatusDetail | null;
  showStatusCard?: boolean;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
  suggestions: SlashCommand[];
  showSuggestions: boolean;
  selectedSuggestion: number;
  isFocused: boolean;
  placeholder?: string;
  suggestionHint?: string;
  footer?: React.ReactNode;
  collapsedPasteSummary?: {
    label: string;
    detail?: string;
  } | null;
}

const formatElapsed = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
};

const SPINNER_FRAMES = ['⠁', '⠃', '⠇', '⠧', '⠷', '⠿', '⠻', '⠟'];

const useSpinner = (active: boolean) => {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 90);

    return () => clearInterval(id);
  }, [active]);

  return active ? SPINNER_FRAMES[frameIndex] : '';
};

const useElapsedTimer = (startedAt?: number, active?: boolean) => {
  const [elapsed, setElapsed] = useState('0s');

  useEffect(() => {
    if (!startedAt || !active) {
      setElapsed('0s');
      return;
    }

    const update = () => {
      const diff = Date.now() - startedAt;
      setElapsed(formatElapsed(diff));
    };

    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [active, startedAt]);

  return elapsed;
};

export const StatusOverlayCard = ({ status, detail }: { status: 'thinking' | 'streaming'; detail?: StatusDetail | null }) => {
  const spinner = useSpinner(true);
  const elapsed = useElapsedTimer(detail?.startedAt, true);
  const headline = detail?.modelName || 'Model';
  const phaseLabel = detail?.phase === 'thinking' ? 'thinking' : 'replying';
  const description = detail?.message || (status === 'thinking' ? 'Planning the next steps' : 'Streaming the reply');

  return (
    <Box borderStyle="round" borderColor={status === 'thinking' ? 'yellow' : 'green'} paddingX={1} paddingY={0} flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text color="cyan" bold>
          {headline} <Text color="gray">· {phaseLabel}</Text>
        </Text>
        <Text color={status === 'thinking' ? 'yellow' : 'green'}>{spinner}</Text>
      </Box>
      <Text>
        <Text color="white">• {description}</Text>
        <Text color="gray">{` (${elapsed} · esc to interrupt)`}</Text>
      </Text>
      <Text color="gray">Ctrl+C exits when idle.</Text>
    </Box>
  );
};

export const InputBar = ({
  value,
  status,
  statusDetail,
  showStatusCard = false,
  onChange,
  onSubmit,
  suggestions,
  showSuggestions,
  selectedSuggestion,
  isFocused,
  placeholder,
  suggestionHint,
  footer,
  collapsedPasteSummary,
}: InputBarProps) => {
  return (
    <Box flexDirection="column" gap={1} width="100%">
      {status !== 'idle' && showStatusCard && <StatusOverlayCard status={status} detail={statusDetail} />}

      {showSuggestions && suggestions.length > 0 && (
        <Box borderStyle="single" borderColor="cyan" flexDirection="column" paddingX={1} gap={0}>
          {suggestionHint && (
            <Box>
              <Text color="gray">{suggestionHint}</Text>
            </Box>
          )}
          {suggestions.map((cmd, idx) => (
            <Box key={cmd.name} flexDirection="row">
              <Text color={idx === selectedSuggestion ? 'black' : 'cyan'} backgroundColor={idx === selectedSuggestion ? 'cyan' : undefined}>
                {cmd.name}
              </Text>
              <Text color="gray"> — {cmd.description}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box flexDirection="column" gap={0} width="100%">
        <Box borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text color="cyan">&gt; </Text>
          {collapsedPasteSummary ? (
            <Box flexDirection="column" flexGrow={1} paddingLeft={1} gap={0}>
              <Text color="yellow">{collapsedPasteSummary.label}</Text>
              {collapsedPasteSummary.detail && <Text color="gray">{collapsedPasteSummary.detail}</Text>}
            </Box>
          ) : (
            <TextInput
              value={value}
              onChange={onChange}
              onSubmit={onSubmit}
              placeholder={placeholder || 'Type a message or / for commands...'}
              focus={isFocused}
            />
          )}
        </Box>
        {footer && (
          <Box paddingX={1} width="100%">
            {footer}
          </Box>
        )}
      </Box>
    </Box>
  );
};
