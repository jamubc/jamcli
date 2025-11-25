import React from 'react';
import { Box } from 'ink';
import { MenuSurface, MenuOptionRow, MenuSectionHeader, MenuHint } from './menu/MenuPrimitives.js';
import type { StatusSpinnerStyleId, StatusTextStyleId } from '../types/config.js';
import type { StatusSpinnerStyleDefinition, StatusTextStyleDefinition } from '../styles/statusStyles.js';

export type StatusStyleOption =
  | {
      kind: 'text';
      id: StatusTextStyleId;
      label: string;
      description?: string;
      source: 'builtin' | 'custom';
      path?: string;
      textStyle: StatusTextStyleDefinition;
    }
  | {
      kind: 'spinner';
      id: StatusSpinnerStyleId;
      label: string;
      description?: string;
      source: 'builtin' | 'custom';
      path?: string;
      spinnerStyle: StatusSpinnerStyleDefinition;
    }
  | {
      kind: 'action';
      id: 'add_custom' | 'manage_custom';
      label: string;
      description?: string;
      meta?: string;
    };

interface StatusStyleModalProps {
  visible: boolean;
  options: StatusStyleOption[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export const StatusStyleModal = ({ visible, options, selectedIndex, onSelect }: StatusStyleModalProps) => {
  if (!visible) return null;

  return (
    <MenuSurface
      title="Status Indicator Style"
      subtitle="Choose shimmer/spinner look"
      borderColor="green"
      footer={
        <Box flexDirection="column" gap={0}>
          <MenuHint text="↑/↓ to navigate · Enter to select · Esc to close" />
          <MenuHint text="Custom styles live in ~/.jamubc/status-styles" />
        </Box>
      }
    >
      <Box flexDirection="column" gap={0}>
        <MenuSectionHeader label="Text styles" />
        {options
          .filter((opt) => opt.kind === 'text')
          .map((opt, idx) => {
            const globalIndex = options.indexOf(opt);
            return (
              <MenuOptionRow
                key={`${opt.id}-${idx}`}
                label={opt.label}
                description={opt.description}
                meta={opt.id}
                isSelected={globalIndex === selectedIndex}
                accentColor="green"
              />
            );
          })}

        <MenuSectionHeader label="Spinner styles" marginTop={1} />
        {options
          .filter((opt) => opt.kind === 'spinner')
          .map((opt, idx) => {
            const globalIndex = options.indexOf(opt);
            return (
              <MenuOptionRow
                key={`${opt.id}-${idx}`}
                label={opt.label}
                description={opt.description}
                meta={opt.id}
                isSelected={globalIndex === selectedIndex}
                accentColor="cyan"
              />
            );
          })}

        <MenuSectionHeader label="Actions" marginTop={1} />
        {options
          .filter((opt) => opt.kind === 'action')
          .map((opt, idx) => {
            const globalIndex = options.indexOf(opt);
            return (
              <MenuOptionRow
                key={`${opt.id}-${idx}`}
                label={opt.label}
                description={opt.description}
                meta={opt.meta}
                isSelected={globalIndex === selectedIndex}
                accentColor="yellow"
              />
            );
          })}
      </Box>
    </MenuSurface>
  );
};
