import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store/index.js';
import * as Diff from 'diff';

export const ActionModal = () => {
  const { pendingAction } = useStore();

  if (!pendingAction) return null;

  const renderContent = () => {
    if (pendingAction.type === 'shell_exec') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="yellow" bold>
            ⚡ Action Proposed: SHELL_EXEC
          </Text>
          <Text color="gray">Command:</Text>
          <Text>{pendingAction.params.command}</Text>
          <Text color="gray">Working Directory:</Text>
          <Text>{pendingAction.params.cwd || process.cwd()}</Text>
        </Box>
      );
    }

    if (pendingAction.type === 'file_edit') {
      const findStr = pendingAction.params.find_string || '';
      const replaceStr = pendingAction.params.replace_string || '';
      const patch = pendingAction.params.patch as string | undefined;

      const diffLines = patch
        ? patch.split('\n').slice(0, 40)
        : Diff.createTwoFilesPatch(
            pendingAction.params.path,
            pendingAction.params.path,
            findStr,
            replaceStr,
            'Before',
            'After'
          )
            .split('\n')
            .slice(4, 24);

      return (
        <Box flexDirection="column" gap={1}>
          <Text color="yellow" bold>
            ⚡ Action Proposed: FILE_EDIT
          </Text>
          <Box flexDirection="row" gap={1}>
            <Text color="gray">File:</Text>
            <Text>{pendingAction.params.path}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text color="gray">Operation:</Text>
            <Text>{patch ? 'apply_patch' : pendingAction.params.operation || 'replace'}</Text>
          </Box>
          <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
            <Text color="cyan" bold>
              Diff Preview:
            </Text>
            {diffLines.map((line, idx) => {
              const color = line.startsWith('-') ? 'red' : line.startsWith('+') ? 'green' : 'white';
              return (
                <Text key={`${line}-${idx}`} color={color}>
                  {line}
                </Text>
              );
            })}
          </Box>
        </Box>
      );
    }

    return null;
  };

  return (
    <Box
      borderStyle="double"
      borderColor="yellow"
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      marginTop={1}
    >
      {renderContent()}
      <Box flexDirection="row" gap={2} marginTop={1}>
        <Text color="green">[y] Confirm</Text>
        <Text color="red">[n] Reject</Text>
      </Box>
    </Box>
  );
};
