/** @jsxImportSource @opentui/react */
import { useTerminalDimensions } from '@opentui/react';
import type { SlashCommand } from './commands.js';
import { framed, usePlain, useTheme } from './theme.js';

/** How many matches the palette shows at once. */
export const PALETTE_ROWS = 8;

/**
 * The commands a typed `/name` could mean, shown above the composer. The chosen one is
 * marked with a word as well as a color. A custom command names where it comes from.
 */
export function Palette({ matches, selected }: { matches: SlashCommand[]; selected: number }) {
  const colors = useTheme();
  const plain = usePlain();
  const { width: columns } = useTerminalDimensions();
  // Inside the border and padding; a line longer than that is cut, not wrapped.
  const room = Math.max(20, columns - 4);
  const fit = (line: string) => (line.length > room ? `${line.slice(0, room - 1)}…` : line);
  const start = Math.min(Math.max(0, selected - PALETTE_ROWS + 1), Math.max(0, matches.length - PALETTE_ROWS));
  const shown = matches.slice(start, start + PALETTE_ROWS);
  const width = Math.min(28, Math.max(...shown.map((command) => command.name.length + (command.args ? command.args.length + 1 : 0))));
  return (
    <box {...framed(plain, colors.border)} flexDirection="column" flexShrink={0}>
      {plain ? <text>{`Commands matching: ${matches.length}`}</text> : null}
      {matches.length === 0 ? (
        <text fg={colors.dim}>No command starts with that. /help lists them.</text>
      ) : (
        shown.map((command, index) => {
          const chosen = start + index === selected;
          const name = `/${command.name}${command.args ? ` ${command.args}` : ''}`;
          const head = name.length >= width ? `${name} ` : name.padEnd(width + 1);
          const from = command.source === 'built-in' ? '' : ` (${command.source})`;
          return (
            <text key={command.name} fg={chosen ? colors.accent : undefined}>
              {fit(`${chosen ? (plain ? 'Chosen: ' : '> ') : '  '}${head} ${command.summary}${from}`)}
            </text>
          );
        })
      )}
      <text fg={colors.dim}>{`${matches.length > PALETTE_ROWS ? `${selected + 1} of ${matches.length} · ` : ''}Up and Down choose · Tab completes · Enter runs · Escape closes`}</text>
    </box>
  );
}
