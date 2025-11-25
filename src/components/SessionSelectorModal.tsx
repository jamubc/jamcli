import React from 'react';
import { Box, Text } from 'ink';
import { MenuSurface, MenuSearchInput, MenuOptionRow, MenuHint, MenuEmptyState } from './menu/MenuPrimitives.js';
import { SessionMetadata } from '../services/HistoryService.js';

interface SessionSelectorModalProps {
  visible: boolean;
  sessions: SessionMetadata[];
  selectedIndex: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (direction: 'prev' | 'next') => void;
}

const ITEMS_PER_PAGE = 8;

export const SessionSelectorModal = ({
  visible,
  sessions,
  selectedIndex,
  searchQuery,
  onSearchChange,
  currentPage,
  totalPages,
  onPageChange,
}: SessionSelectorModalProps) => {
  if (!visible) return null;

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatTokens = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const startIdx = currentPage * ITEMS_PER_PAGE;
  const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, sessions.length);
  const pageItems = sessions.slice(startIdx, endIdx);

  return (
    <MenuSurface
      title="📜 Resume Session"
      subtitle={`${sessions.length} found`}
      borderColor="cyan"
      footer={
        <Box flexDirection="column" gap={0}>
          {totalPages > 1 && (
            <Text color="gray" dimColor>
              Page {currentPage + 1} of {totalPages} · Showing {sessions.length === 0 ? 0 : startIdx + 1}-{endIdx}
            </Text>
          )}
          <MenuHint text="↑/↓ navigate • ←/→ page • Enter resume • Esc cancel" />
        </Box>
      }
    >
      <MenuSearchInput
        value={searchQuery}
        onChange={onSearchChange}
        placeholder="Filter by title, project, or ID"
        isFocused={visible}
      />

      {pageItems.length === 0 ? (
        <MenuEmptyState message={searchQuery ? 'No sessions match your search.' : 'No sessions found.'} />
      ) : (
        <Box flexDirection="column" gap={0}>
          {pageItems.map((session, idx) => {
            const globalIdx = startIdx + idx;
            const isSelected = globalIdx === selectedIndex;
            const displayTitle = session.title ||
              (session.firstUserMessage
                ? `${session.firstUserMessage.substring(0, 40)}...`
                : 'Untitled conversation');

            return (
              <MenuOptionRow
                key={session.id}
                label={displayTitle.length > 42 ? `${displayTitle.substring(0, 39)}...` : displayTitle}
                meta={formatDate(session.updated)}
                isSelected={isSelected}
              >
                <Box flexDirection="row" gap={1}>
                  <Text color={isSelected ? 'black' : 'gray'} dimColor={!isSelected}>
                    {(session.projectName.length > 18
                      ? `${session.projectName.substring(0, 15)}...`
                      : session.projectName) || 'untracked project'}
                  </Text>
                  <Text color={isSelected ? 'black' : 'yellow'} dimColor={!isSelected}>
                    {formatTokens(session.totalTokens)}
                  </Text>
                  <Text color={isSelected ? 'black' : 'gray'} dimColor>
                    {session.messageCount} msgs
                  </Text>
                  {session.model && (
                    <Text color={isSelected ? 'black' : 'blue'} dimColor={!isSelected}>
                      {session.model}
                    </Text>
                  )}
                </Box>
              </MenuOptionRow>
            );
          })}
        </Box>
      )}
    </MenuSurface>
  );
};
