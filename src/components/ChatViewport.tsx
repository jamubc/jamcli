import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useStore } from '../store/index.js';
import { DEFAULT_SPINNER_FRAMES, useColorSpinner, useElapsedTimer } from '../hooks/useStatusIndicator.js';
import type { Message } from '../store/index.js';
import type { StatusStyleDefinition } from '../styles/statusStyles.js';

const ROLE_META: Record<Message['role'], { prefix: string; color: any }> = {
  user: { prefix: '›', color: 'cyan' },
  assistant: { prefix: '•', color: 'green' },
  system: { prefix: '!', color: 'yellow' },
  tool: { prefix: '⚙', color: 'gray' },
};

const DEFAULT_RESERVED_LINES = 12;
const DEFAULT_MIN_VISIBLE_LINES = 10;
const MIN_CONTENT_WIDTH = 40;
const MAX_REASONING_PREVIEW_LINES = 3;

const computeReservedLines = (availableRows: number) => {
  if (availableRows <= 14) return 4;
  if (availableRows <= 20) return 6;
  if (availableRows <= 28) return 8;
  return DEFAULT_RESERVED_LINES;
};

const computeMinVisibleLines = (availableRows: number) => {
  if (availableRows <= 12) return 3;
  if (availableRows <= 18) return 4;
  if (availableRows <= 26) return 6;
  return DEFAULT_MIN_VISIBLE_LINES;
};

const getUsableWidth = (availableColumns: number) => {
  return Math.max(MIN_CONTENT_WIDTH, (availableColumns ?? MIN_CONTENT_WIDTH) - 4);
};

const wrapContentLines = (text: string, availableColumns: number) => {
  const usableWidth = getUsableWidth(availableColumns);
  const rawLines = text ? text.split(/\r?\n/) : [''];

  return rawLines.flatMap((line) => {
    if (line.length === 0) {
      return [''];
    }

    const segments: string[] = [];
    let remaining = line;

    while (remaining.length > usableWidth) {
      segments.push(remaining.slice(0, usableWidth));
      remaining = remaining.slice(usableWidth);
    }

    segments.push(remaining);
    return segments;
  });
};

type VisibleMessage = {
  message: Message;
  contentLines: string[];
  reasoningLines: string[];
  isContentTruncated: boolean;
};

const selectVisibleMessages = (messages: Message[], maxLines: number, availableColumns: number): VisibleMessage[] => {
  if (messages.length === 0) {
    return [];
  }

  let remainingLines = maxLines;
  const selected: VisibleMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const wrappedContent = wrapContentLines(message.content, availableColumns);
    const wrappedReasoning = message.reasoning ? wrapContentLines(message.reasoning, availableColumns) : [];
    
    // In compact view, we only show a limited preview of reasoning
    const reasoningCost = Math.min(wrappedReasoning.length, MAX_REASONING_PREVIEW_LINES);
    // Add 1 line for the "Thinking..." header if reasoning exists
    const reasoningHeaderCost = reasoningCost > 0 ? 1 : 0;
    
    const baseLines = Math.max(1, wrappedContent.length);
    const separatorLines = selected.length === 0 ? 0 : 1;
    const totalLines = baseLines + separatorLines + reasoningCost + reasoningHeaderCost;

    if (totalLines <= remainingLines) {
      selected.unshift({
        message,
        contentLines: wrappedContent,
        reasoningLines: wrappedReasoning,
        isContentTruncated: false,
      });
      remainingLines -= totalLines;
      if (remainingLines <= 0) {
        break;
      }
      continue;
    }

    if (selected.length === 0 && remainingLines > 1) {
      // Try to fit at least some content. Prioritize content over reasoning in tight spaces?
      // Let's just truncate content for simplicity in this edge case.
      const allowedContentLines = Math.max(0, remainingLines - 1); // reserve 1 for header/separator
      const truncatedLines = wrappedContent.slice(-allowedContentLines);
      selected.unshift({
        message,
        contentLines: truncatedLines,
        reasoningLines: [], // Hide reasoning if we are crunching content this hard
        isContentTruncated: truncatedLines.length < wrappedContent.length,
      });
    }
    break;
  }

  return selected;
};

type StatusDetail = {
  phase: 'thinking' | 'streaming';
  modelName?: string;
  message: string;
  startedAt: number;
};

type ChatViewportProps = {
  isExpanded: boolean;
  reservedLineBoost?: number;
  status?: 'idle' | 'thinking' | 'streaming';
  statusDetail?: StatusDetail | null;
  statusStyle?: StatusStyleDefinition;
};

export const ChatViewport = ({ isExpanded, reservedLineBoost = 0, status = 'idle', statusDetail, statusStyle }: ChatViewportProps) => {
  const messages = useStore((s) => s.messages);
  const { stdout } = useStdout();
  const [terminalSize, setTerminalSize] = useState({
    rows: stdout?.rows ?? 24,
    columns: stdout?.columns ?? 80,
  });

  useEffect(() => {
    if (!stdout) return;

    const handleResize = () => {
      setTerminalSize({
        rows: stdout.rows ?? 24,
        columns: stdout.columns ?? 80,
      });
    };

    stdout.on('resize', handleResize);
    return () => {
      if (typeof stdout.off === 'function') {
        stdout.off('resize', handleResize);
      } else {
        stdout.removeListener('resize', handleResize);
      }
    };
  }, [stdout]);

  // Hooks MUST be called unconditionally at the top level
  const showStatusLine = status !== 'idle' && Boolean(statusDetail);
  const shimmerColors = statusStyle?.shimmerColors?.length ? statusStyle.shimmerColors : ['gray'];
  const spinnerFrames = statusStyle?.spinnerFrames?.length ? statusStyle.spinnerFrames : DEFAULT_SPINNER_FRAMES;
  const spinnerColors = statusStyle?.spinnerColors?.length ? statusStyle.spinnerColors : shimmerColors;
  
  // Always call these hooks
  const spinnerFrame = useColorSpinner(spinnerFrames, showStatusLine, spinnerColors, statusStyle?.spinnerIntervalMs);
  const elapsed = useElapsedTimer(statusDetail?.startedAt, showStatusLine);

  const availableRows = terminalSize.rows ?? 24;
  const availableColumns = terminalSize.columns ?? 80;
  const reservedLines = computeReservedLines(availableRows) + reservedLineBoost;
  const baseMinVisible = computeMinVisibleLines(availableRows);
  const minVisibleLines = reservedLineBoost > 0 ? Math.max(3, Math.min(baseMinVisible, 6)) : baseMinVisible;
  const maxLines = Math.max(minVisibleLines, availableRows - reservedLines);

  const visibleMessages = useMemo(
    () => selectVisibleMessages(messages, maxLines, availableColumns),
    [messages, maxLines, availableColumns]
  );
  const isTruncated = visibleMessages.length < messages.length || visibleMessages.some((msg) => msg.isContentTruncated);

  const phaseLabel = statusDetail?.phase === 'thinking' ? 'thinking' : 'replying';
  const statusLineText = statusDetail
    ? `${statusDetail.modelName || 'Model'} · ${phaseLabel}: ${statusDetail.message}`
    : phaseLabel === 'thinking'
      ? 'Working…'
      : 'Replying…';

  // Conditional Rendering Logic
  if (isExpanded) {
    return (
      <Box flexDirection="column" flexGrow={1} gap={1} marginBottom={1}>
        {messages.length === 0 ? (
          <Box flexDirection="column" alignItems="center" justifyContent="center" paddingY={2}>
            <Text color="gray" bold>
              {'Welcome to JamCLI <3'}
            </Text>
            <Text color="gray">Type or use /</Text>
          </Box>
        ) : (
          <>
            {visibleMessages.map(({ message, contentLines, reasoningLines }, index) => {
              const meta = ROLE_META[message.role] || ROLE_META.user;
              const prefix = `${meta.prefix} `;
              const spacer = ' '.repeat(prefix.length);
              const hasReasoning = reasoningLines.length > 0;

              return (
                <Box key={`${message.timestamp}-${message.role}-${index}`} flexDirection="column" marginBottom={1}>
                  {hasReasoning && (
                    <Box flexDirection="column" marginLeft={2} marginBottom={1}>
                      <Text color="gray" italic>
                        {'Thinking...'}
                      </Text>
                      {reasoningLines.map((line, rIdx) => (
                        <Text key={`expanded-reasoning-${index}-${rIdx}`} color="gray" dimColor>
                          {'│ ' + line}
                        </Text>
                      ))}
                    </Box>
                  )}

                  {contentLines.map((line, lineIdx) => (
                    <Text key={`${message.timestamp}-${message.role}-${index}-${lineIdx}`} wrap="wrap">
                      <Text color={meta.color} bold>
                        {lineIdx === 0 ? prefix : spacer}
                      </Text>
                      <Text>{line}</Text>
                    </Text>
                  ))}

                  {index < visibleMessages.length - 1 && <Text color="gray">....................</Text>}
                </Box>
              );
            })}
            <Box marginTop={0} paddingTop={0}>
              <Text color="cyan">Full history visible. Press Ctrl+R to return to compact view.</Text>
            </Box>
          </>
        )}
      </Box>
    );
  }

  // Fixed Mode (Compact/TUI)
  return (
    <Box flexDirection="column" flexGrow={1} gap={1} marginBottom={1}>
      <Box
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        paddingY={0}
        flexDirection="column"
        flexGrow={1}
      >
        {messages.length === 0 ? (
          <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <Text color="gray" bold>
              {'Welcome to JamCLI <3'}
            </Text>
            <Text color="gray">Type or use /</Text>
          </Box>
        ) : (
          <>
            {visibleMessages.map(({ message, contentLines, reasoningLines }, index) => {
              const meta = ROLE_META[message.role] || ROLE_META.user;
              const prefix = `${meta.prefix} `;
              const spacer = ' '.repeat(prefix.length);
              const lines = contentLines.length > 0 ? contentLines : [''];
              
              const hasReasoning = reasoningLines.length > 0;
              const displayedReasoning = hasReasoning 
                ? reasoningLines.slice(-MAX_REASONING_PREVIEW_LINES)
                : [];

              return (
                <Box key={`${message.timestamp}-${message.role}-${index}`} flexDirection="column" marginBottom={1}>
                  {hasReasoning && (
                    <Box flexDirection="column" marginLeft={2} marginBottom={1}>
                      <Text color="gray" italic>
                        {'Thinking Process:'}
                      </Text>
                      {displayedReasoning.map((line, rIdx) => (
                        <Text key={`reasoning-${index}-${rIdx}`} color="gray" dimColor>
                          {'│ ' + line}
                        </Text>
                      ))}
                    </Box>
                  )}
                  
                  {lines.map((line, lineIdx) => (
                    <Text key={`${message.timestamp}-${message.role}-${index}-${lineIdx}`} wrap="wrap">
                      <Text color={meta.color} bold>
                        {lineIdx === 0 ? prefix : spacer}
                      </Text>
                      <Text>{line}</Text>
                    </Text>
                  ))}
                  {index < visibleMessages.length - 1 && <Text color="gray">....................</Text>}
                </Box>
              );
            })}
            {isTruncated && (
              <Box marginTop={0} paddingTop={0}>
                <Text color="yellow">
                  Showing latest {visibleMessages.length} of {messages.length} messages. Press Ctrl+R to view full history.
                </Text>
              </Box>
            )}
          </>
        )}
        {showStatusLine && (
          <Box marginTop={1} flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box flexDirection="row" gap={1}>
              {spinnerFrame && <Text color={spinnerFrame.color}>{spinnerFrame.frame}</Text>}
              <Text>
                <Text color={statusStyle?.shimmer ?? true ? undefined : 'white'} bold={!(statusStyle?.shimmer ?? true)}>
                  {statusLineText}
                </Text>
                <Text color="gray">{` (${elapsed} · esc to interrupt)`}</Text>
              </Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};
