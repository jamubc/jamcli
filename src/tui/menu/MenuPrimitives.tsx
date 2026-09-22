import React, { ReactNode } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface MenuSurfaceProps {
  title: string;
  subtitle?: ReactNode;
  borderColor?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export const MenuSurface = ({
  title,
  subtitle,
  borderColor = 'cyan',
  children,
  footer,
}: MenuSurfaceProps) => {
  return (
    <Box
      borderStyle="round"
      borderColor={borderColor}
      flexDirection="column"
      paddingX={1}
      paddingY={0}
      marginY={1}
      gap={1}
    >
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text color={borderColor} bold>
          {title}
        </Text>
        {subtitle && <Text color="gray">{subtitle}</Text>}
      </Box>
      {children}
      {footer && <Box>{footer}</Box>}
    </Box>
  );
};

interface MenuSectionHeaderProps {
  label: string;
  color?: string;
  marginTop?: number;
}

export const MenuSectionHeader = ({ label, color = 'yellow', marginTop = 0 }: MenuSectionHeaderProps) => (
  <Box paddingX={1} marginTop={marginTop}>
    <Text color={color} bold>
      {label}
    </Text>
  </Box>
);

interface MenuOptionRowProps {
  label: string;
  description?: string;
  meta?: string;
  isSelected?: boolean;
  accentColor?: string;
  children?: ReactNode;
}

export const MenuOptionRow = ({
  label,
  description,
  meta,
  isSelected = false,
  accentColor = 'cyan',
  children,
}: MenuOptionRowProps) => {
  const backgroundColor = isSelected ? accentColor : undefined;
  const foregroundColor = isSelected ? 'black' : 'white';
  const secondaryColor = isSelected ? 'black' : 'gray';

  return (
    <Box
      paddingX={2}
      paddingY={0}
      flexDirection="column"
      backgroundColor={backgroundColor}
      gap={0}
    >
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Text color={foregroundColor} bold={isSelected}>
          {label}
        </Text>
        {meta && (
          <Text color={secondaryColor} dimColor={!isSelected}>
            {meta}
          </Text>
        )}
      </Box>
      {children ? (
        children
      ) : (
        description && (
          <Text color={secondaryColor} dimColor>
            {description}
          </Text>
        )
      )}
    </Box>
  );
};

interface MenuSearchInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  isFocused?: boolean;
  editable?: boolean;
}

export const MenuSearchInput = ({
  label = 'Search',
  value,
  onChange,
  onSubmit,
  placeholder = 'Type to filter…',
  isFocused = false,
  editable = true,
}: MenuSearchInputProps) => {
  if (!editable) {
    return (
      <Box flexDirection="row" alignItems="center" paddingX={1}>
        <Text color="gray">{label}: </Text>
        <Text color={value ? 'white' : 'gray'} dimColor={!value}>
          {value || placeholder}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" alignItems="center" paddingX={1}>
      <Text color="gray">{label}: </Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={placeholder}
        focus={isFocused}
      />
    </Box>
  );
};

interface MenuHintProps {
  text: string;
  color?: string;
}

export const MenuHint = ({ text, color = 'gray' }: MenuHintProps) => (
  <Text color={color} dimColor>
    {text}
  </Text>
);

interface MenuEmptyStateProps {
  message: string;
  color?: string;
}

export const MenuEmptyState = ({ message, color = 'yellow' }: MenuEmptyStateProps) => (
  <Box paddingX={1} paddingY={1}>
    <Text color={color}>{message}</Text>
  </Box>
);
