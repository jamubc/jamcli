/**
 * A scripted language server for tests, on JamCLI's own JSON-RPC layer over stdio. A line
 * containing ERROR is reported as an error, `function name` lines are symbols, hover names
 * the word under the position, and definition and references point at `function` lines.
 */
import { JsonRpcConnection } from '../core/protocols/jsonrpc/connection.js';
import { contentLengthFraming } from '../core/protocols/jsonrpc/framing.js';

const texts = new Map<string, string>();
const connection = new JsonRpcConnection({ framing: contentLengthFraming, write: (bytes) => void process.stdout.write(bytes) });
process.stdin.on('data', (chunk: Buffer) => connection.receive(new Uint8Array(chunk)));

const lines = (uri: string) => (texts.get(uri) ?? '').split('\n');
const publish = (uri: string) => {
  const diagnostics = lines(uri).flatMap((line, index) =>
    line.includes('ERROR') ? [{ range: { start: { line: index, character: line.indexOf('ERROR') }, end: { line: index, character: line.indexOf('ERROR') + 5 } }, severity: 1, message: `found ERROR on line ${index + 1}`, source: 'fake' }] : []
  );
  // A little later, as a real server would.
  setTimeout(() => connection.notify('textDocument/publishDiagnostics', { uri, diagnostics }), 20);
};
const wordAt = (uri: string, position: { line: number; character: number }) => {
  const line = lines(uri)[position.line] ?? '';
  const before = /\w*$/.exec(line.slice(0, position.character))![0];
  const after = /^\w*/.exec(line.slice(position.character))![0];
  return before + after;
};
const functionLines = (uri: string, name?: string) =>
  lines(uri).flatMap((line, index) => {
    const match = /function (\w+)/.exec(line);
    return match && (!name || match[1] === name) ? [{ name: match[1], line: index, character: match.index + 9 }] : [];
  });

connection.onRequest('initialize', () => ({ capabilities: { textDocumentSync: 1, hoverProvider: true, definitionProvider: true, referencesProvider: true, documentSymbolProvider: true }, serverInfo: { name: 'fake-lsp' } }));
connection.onNotification('initialized', () => {
  // Real servers ask the client for settings; the client must answer.
  void connection.request('workspace/configuration', { items: [{ section: 'fake' }] }).catch(() => undefined);
});
connection.onNotification('textDocument/didOpen', (params) => {
  texts.set(params.textDocument.uri, params.textDocument.text);
  publish(params.textDocument.uri);
});
connection.onNotification('textDocument/didChange', (params) => {
  texts.set(params.textDocument.uri, params.contentChanges.at(-1).text);
  publish(params.textDocument.uri);
});
connection.onRequest('textDocument/hover', (params) => ({ contents: { kind: 'plaintext', value: `word ${wordAt(params.textDocument.uri, params.position)}` } }));
connection.onRequest('textDocument/definition', (params) =>
  functionLines(params.textDocument.uri, wordAt(params.textDocument.uri, params.position)).map((found) => ({ uri: params.textDocument.uri, range: { start: { line: found.line, character: found.character }, end: { line: found.line, character: found.character } } }))
);
connection.onRequest('textDocument/references', (params) => {
  const word = wordAt(params.textDocument.uri, params.position);
  return lines(params.textDocument.uri).flatMap((line, index) => (line.includes(word) ? [{ uri: params.textDocument.uri, range: { start: { line: index, character: line.indexOf(word) }, end: { line: index, character: line.indexOf(word) } } }] : []));
});
connection.onRequest('textDocument/documentSymbol', (params) =>
  functionLines(params.textDocument.uri).map((found) => ({ name: found.name, kind: 12, range: { start: { line: found.line, character: 0 }, end: { line: found.line, character: 0 } }, selectionRange: { start: { line: found.line, character: 0 }, end: { line: found.line, character: 0 } } }))
);
connection.onRequest('shutdown', () => null);
connection.onNotification('exit', () => process.exit(0));
