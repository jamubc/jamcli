/**
 * A scripted language server for tests, on JamCLI's own JSON-RPC layer over stdio. A line
 * containing ERROR is an error and WARN is a warning, `function name` lines are symbols,
 * hover names the word under the position, and definition and references point at
 * `function` lines. The `fail-once` argument makes the first start exit, `stubborn` ignores
 * shutdown, and `fake/opens`, `fake/changes`, and `fake/configuration` report what the
 * client sent.
 */
import fs from 'fs';
import path from 'path';
import { JsonRpcConnection } from '../core/protocols/jsonrpc/connection.js';
import { contentLengthFraming } from '../core/protocols/jsonrpc/framing.js';

const stubborn = process.argv.includes('stubborn');
const probing = process.argv.includes('probe');
if (process.argv.includes('fail-once')) {
  const marker = path.join(process.cwd(), '.failed-once');
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, '1');
    process.exit(1);
  }
}

const texts = new Map<string, string>();
const opens = new Map<string, number>();
let changes = 0;
let configuration: unknown;
let markConfigured!: () => void;
/** Resolves only when the client answers workspace/configuration. */
const configured = new Promise<void>((resolve) => (markConfigured = resolve));

const connection = new JsonRpcConnection({ framing: contentLengthFraming, write: (bytes) => void process.stdout.write(bytes) });
process.stdin.on('data', (chunk: Buffer) => connection.receive(new Uint8Array(chunk)));

const lines = (uri: string) => (texts.get(uri) ?? '').split('\n');
const hiddenNow = () => {
  try {
    return fs.readFileSync(process.env.FAKE_LSP_HIDDEN ?? '', 'utf8').trim() || 'empty';
  } catch {
    return 'blocked';
  }
};
/** In probe mode, one extra diagnostic says what this process can see. */
const probeDiagnostic = () =>
  probing ? [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, severity: 1, message: `env=${process.env.JAMCLI_PROBE_ONLY ?? 'absent'} hidden=${hiddenNow()}`, source: 'probe' }] : [];
const publish = (uri: string) => {
  const found = (word: string, severity: number) =>
    lines(uri).flatMap((line, index) => {
      const character = line.indexOf(word);
      return character < 0 ? [] : [{ range: { start: { line: index, character }, end: { line: index, character: character + word.length } }, severity, message: `found ${word} on line ${index + 1}`, source: 'fake' }];
    });
  // A little later, as a real server would.
  setTimeout(() => connection.notify('textDocument/publishDiagnostics', { uri, diagnostics: [...found('ERROR', 1), ...found('WARN', 2), ...probeDiagnostic()] }), 20);
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
  // Real servers ask the client for settings and wait for the answer before serving.
  void connection.request('workspace/configuration', { items: [{ section: 'fake' }] }).then(
    (answer) => {
      configuration = answer;
      markConfigured();
    },
    () => undefined
  );
});
connection.onNotification('textDocument/didOpen', (params) => {
  const uri = params.textDocument.uri;
  opens.set(uri, (opens.get(uri) ?? 0) + 1);
  // A second open for the same file is refused: a real client changes it instead.
  if (texts.has(uri)) return;
  texts.set(uri, params.textDocument.text);
  publish(uri);
});
connection.onNotification('textDocument/didChange', (params) => {
  changes += 1;
  texts.set(params.textDocument.uri, params.contentChanges.at(-1).text);
  publish(params.textDocument.uri);
});
connection.onRequest('textDocument/hover', async (params) => {
  await configured;
  return { contents: { kind: 'plaintext', value: `word ${wordAt(params.textDocument.uri, params.position)}` } };
});
connection.onRequest('textDocument/definition', async (params) => {
  await configured;
  return functionLines(params.textDocument.uri, wordAt(params.textDocument.uri, params.position)).map((found) => ({ uri: params.textDocument.uri, range: { start: { line: found.line, character: found.character }, end: { line: found.line, character: found.character } } }));
});
connection.onRequest('textDocument/references', async (params) => {
  await configured;
  const word = wordAt(params.textDocument.uri, params.position);
  return lines(params.textDocument.uri).flatMap((line, index) => (line.includes(word) ? [{ uri: params.textDocument.uri, range: { start: { line: index, character: line.indexOf(word) }, end: { line: index, character: line.indexOf(word) } } }] : []));
});
connection.onRequest('textDocument/documentSymbol', async (params) => {
  await configured;
  return functionLines(params.textDocument.uri).map((found) => ({ name: found.name, kind: 12, range: { start: { line: found.line, character: 0 }, end: { line: found.line, character: 0 } }, selectionRange: { start: { line: found.line, character: 0 }, end: { line: found.line, character: 0 } } }));
});
connection.onRequest('fake/opens', () => Object.fromEntries(opens));
connection.onRequest('fake/changes', () => changes);
connection.onRequest('fake/configuration', () => configuration);
connection.onRequest('fake/probe', () => ({ hidden: hiddenNow(), env: process.env.JAMCLI_PROBE_ONLY ?? 'absent' }));
connection.onRequest('shutdown', () => (stubborn ? new Promise(() => {}) : null));
connection.onNotification('exit', () => {
  if (!stubborn) process.exit(0);
});
