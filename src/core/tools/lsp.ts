import path from 'path';
import type { RegisteredTool } from '../../types/tools.js';
import { formatDiagnostic, type LspManager } from '../lsp/manager.js';
import { resolveProjectPath } from './paths.js';

const OPERATIONS = ['diagnostics', 'hover', 'definition', 'references', 'symbols'] as const;

const hoverText = (contents: any): string => {
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join('\n\n');
  return String(contents.value ?? '');
};

const symbolLines = (symbols: any[], manager: LspManager, depth = 0): string[] =>
  symbols.flatMap((symbol) => {
    const range = symbol.range ?? symbol.location?.range;
    const line = range ? `:${range.start.line + 1}` : '';
    return [`${'  '.repeat(depth)}${symbol.name}${symbol.detail ? ` ${symbol.detail}` : ''}${line}`, ...symbolLines(symbol.children ?? [], manager, depth + 1)];
  });

/**
 * Ask the project's language server: a file's diagnostics, what a symbol is, where it is
 * defined or used, or a file's outline. Lines and columns are 1-based, as the tools show them.
 */
export function lspTool(manager: LspManager): RegisteredTool {
  return {
    name: 'lsp',
    description: `Ask the language server (${manager.available.join(', ')}) about code: diagnostics for a file, hover for the type or docs at a position, definition, references, or a file's symbols. Lines and columns are 1-based.`,
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: [...OPERATIONS] },
        path: { type: 'string', description: 'The file, relative to the project.' },
        line: { type: 'number', description: 'For hover, definition, and references: the 1-based line.' },
        column: { type: 'number', description: 'For hover, definition, and references: the 1-based column.' },
      },
      required: ['operation', 'path'],
      additionalProperties: false,
    },
    policy: 'read',
    runner: async (args, context) => {
      let absolute: string;
      try {
        absolute = resolveProjectPath(context.projectRoot, String(args.path ?? ''));
      } catch (error: any) {
        return { output: error?.message ?? String(error), status: 'error' };
      }
      const file = path.relative(context.projectRoot, absolute);
      const line = Math.max(0, Number(args.line ?? 1) - 1);
      const column = Math.max(0, Number(args.column ?? 1) - 1);
      try {
        switch (args.operation) {
          case 'diagnostics': {
            const { diagnostics } = await manager.diagnostics(absolute);
            return { output: diagnostics.length ? diagnostics.map((item) => formatDiagnostic(file, item)).join('\n') : `No diagnostics for ${file}.`, metadata: { count: diagnostics.length } };
          }
          case 'hover': {
            const hover: any = await manager.at('textDocument/hover', absolute, line, column);
            return { output: hoverText(hover?.contents) || `Nothing is known at ${file}:${line + 1}:${column + 1}.` };
          }
          case 'definition':
          case 'references': {
            const found: any = await manager.at(`textDocument/${args.operation}`, absolute, line, column, args.operation === 'references' ? { context: { includeDeclaration: true } } : {});
            const list = (Array.isArray(found) ? found : found ? [found] : []).map((item: any) => manager.where(item.uri ?? item.targetUri, item.range ?? item.targetSelectionRange ?? item.targetRange));
            return { output: list.length ? list.join('\n') : `No ${args.operation} found at ${file}:${line + 1}:${column + 1}.`, metadata: { count: list.length } };
          }
          case 'symbols': {
            const lines = symbolLines(await manager.symbols(absolute), manager);
            return { output: lines.length ? lines.join('\n') : `No symbols in ${file}.` };
          }
          default:
            return { output: `Unknown operation ${String(args.operation)}. Use one of ${OPERATIONS.join(', ')}.`, status: 'error' };
        }
      } catch (error: any) {
        return { output: `The language server could not answer: ${error?.message ?? error}`, status: 'error' };
      }
    },
  };
}
