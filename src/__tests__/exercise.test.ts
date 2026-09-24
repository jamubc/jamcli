import { afterAll, beforeAll, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startFakeProvider, type FakeProviderServer } from '../testing/fakeProvider.js';
import { KEYS, openTerminal, type TerminalSession } from '../testing/terminal.js';

/**
 * The interface as a person meets it: the real entry point in a pseudo-terminal, read
 * through a terminal emulator, against a fake Ollama. One session goes through a reply,
 * an approval, a rejection, a mode switch, every slash command, /resume, /compact, and
 * leaving. Each step waits for what a person would see before the next one starts.
 */

let server: FakeProviderServer;
let base: string;
let jam: TerminalSession;

beforeAll(() => {
  server = startFakeProvider();
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-exercise-')));
  fs.mkdirSync(path.join(base, 'user'));
  fs.mkdirSync(path.join(base, 'project'));
  fs.writeFileSync(path.join(base, 'user', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, model: 'ollama:fake-model' }));
  const env: Record<string, string | undefined> = { ...process.env, JAMCLI_CONFIG_DIR: path.join(base, 'user'), JAMCLI_STATE_DIR: path.join(base, 'state'), JAMCLI_CACHE_DIR: path.join(base, 'cache') };
  for (const name of ['JAMCLI_MODEL', 'JAMCLI_PROFILE', 'JAMCLI_PERMISSION_MODE', 'NO_COLOR']) delete env[name];
  jam = openTerminal([], { cwd: path.join(base, 'project'), env });
});

afterAll(() => {
  jam.close();
  server.close();
  fs.rmSync(base, { recursive: true, force: true });
});

/** Type a line and press Enter. */
const send = (line: string) => {
  jam.type(line);
  jam.type(KEYS.enter);
};

/** Run a slash command and wait for what it shows; an overlay is closed again. */
async function command(line: string, shows: string | RegExp, overlay = false): Promise<string> {
  send(line);
  const screen = await jam.waitFor(shows);
  if (overlay) {
    jam.type(KEYS.escape);
    await jam.waitFor((now) => !(typeof shows === 'string' ? now.includes(shows) : shows.test(now)));
  }
  return screen;
}

test('a session through every command, as a person meets it', async () => {
  await jam.waitFor('default mode · ollama:fake-model');
  // The status line had the session's facts from the first frame; it never said otherwise.
  expect(jam.written()).not.toContain('no model');

  // A reply, drawn from its Markdown.
  server.enqueue({ text: 'Hello **there**.' });
  send('hi');
  await jam.waitFor('Hello there.');

  // One approval: the prompt, then 1 runs the command.
  server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'echo approved-output' } }] }, { text: 'Ran it.' });
  send('run it');
  await jam.waitFor('Allow run_command echo approved-output?');
  jam.type('1');
  const approved = await jam.waitFor('Ran it.');
  expect(approved).toContain('done: run_command echo approved-output');

  // One rejection: Escape denies, and the turn says so.
  server.enqueue({ toolCalls: [{ id: 'c2', name: 'run_command', arguments: { command: 'rm -rf build' } }] });
  send('clean up');
  await jam.waitFor('Allow run_command rm -rf build?');
  jam.type(KEYS.escape);
  await jam.waitFor('denied: run_command rm -rf build');

  // A mode switch by key, and back by command.
  jam.type(KEYS.shiftTab);
  await jam.waitFor('accept-edits mode ·');
  await command('/mode default', /^default mode ·/m);

  // Every command.
  await command('/help', 'Keys: Enter sends', true);
  await command('/setup', 'Set up JamCLI: choose the model to work with', true);
  await command('/model', 'Models the configured providers offer', true);
  await command('/style', 'Working indicator styles', true);
  await command('/theme', 'light text on a dark background', true);
  await command('/config', 'Settings, each with the file it comes from', true);
  await command('/permissions', 'Mode: default.');
  await command('/context', 'Compaction starts at');
  await command('/cost', 'This session:');
  await command('/tools', 'tools offered to the model');
  await command('/mcp', 'No MCP servers configured.');
  await command('/categories', 'Model categories (defaults):');
  // With no profile files, it says where they would go: here, the user directory in use.
  expect(await command('/profile', 'The profile is default')).toContain(`${path.join(base, 'user', 'profiles')}${path.sep}`);
  await command('/doctor', /JamCLI \S+ on linux/);
  await command('/export notes.md', 'Wrote notes.md.');
  expect(fs.readFileSync(path.join(base, 'project', 'notes.md'), 'utf8')).toContain('approved-output');
  await command('/copy', /Copied \d+ messages|cannot take text for the clipboard/);
  await command('/undo', '/undo is not available yet.');

  // /compact summarizes through the model, or says the conversation is too short.
  server.enqueue({ text: 'Summary: said hello, ran one command, refused another.' });
  const compacted = await command('/compact', /The earlier conversation was summarized: [\d,]+ to [\d,]+ tokens\.|Nothing to compact yet/);
  expect(compacted.match(/The earlier conversation was summarized/g)?.length ?? 0).toBeLessThanOrEqual(1);

  // /fork and /clear each open another session; /resume brings the first one back.
  await command('/fork', 'Forked ');
  await command('/clear', 'New session.');
  send('/resume');
  await jam.waitFor('Sessions in this project, latest first');
  jam.type(KEYS.down);
  jam.type(KEYS.enter);
  await jam.waitFor(/Resumed \S+\./);

  // Two Ctrl+C in a row leave.
  send('/exit');
  expect(await Promise.race([jam.exited, Bun.sleep(5_000).then(() => 'still running')])).toBe(0);
}, 90_000);
