import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { frameRow, legacyUi, statusStyleFor } from '../statusStyle.js';

let dir: string;
const shared = process.env.JAMCLI_CONFIG_DIR;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-style-'));
  process.env.JAMCLI_CONFIG_DIR = path.join(dir, 'user');
  fs.mkdirSync(process.env.JAMCLI_CONFIG_DIR);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  if (shared === undefined) delete process.env.JAMCLI_CONFIG_DIR;
  else process.env.JAMCLI_CONFIG_DIR = shared;
});

test('with nothing chosen the indicator is the classic spinner with subtle words', async () => {
  const style = await statusStyleFor({}, {});
  expect(style.spinnerStyleId).toBe('classic');
  expect(style.textStyleId).toBe('subtle');
  expect(style.spinnerIntervalMs).toBe(80);
});

test('a style chosen in the Ink interface carries over, and the ui block wins over it', async () => {
  const legacyFile = path.join(dir, 'ui.json');
  const mine = path.join(dir, 'mine.json');
  fs.writeFileSync(mine, JSON.stringify({ spinnerFrames: ['<', '>'], spinnerColors: ['red'], spinnerIntervalMs: 50, shimmerColors: ['blue'], shimmer: false }));
  fs.writeFileSync(legacyFile, JSON.stringify({ status_indicator_style: 'subtle', status_text_style: 'aurora', status_spinner_style: 'custom:mine', custom_status_styles: { mine: { path: mine } } }));
  const legacy = legacyUi(legacyFile);
  const carried = await statusStyleFor({}, legacy);
  expect(carried).toMatchObject({ textStyleId: 'aurora', spinnerStyleId: 'custom:mine', spinnerFrames: ['<', '>'], spinnerColors: ['red'], spinnerIntervalMs: 50, source: 'custom' });
  const chosen = await statusStyleFor({ status_spinner_style: 'orbit' }, legacy);
  expect(chosen).toMatchObject({ textStyleId: 'aurora', spinnerStyleId: 'orbit', spinnerFrames: ['◐', '◓', '◑', '◒'] });
  expect(legacyUi(path.join(dir, 'absent.json'))).toEqual({});
  fs.writeFileSync(legacyFile, '{ nope');
  expect(legacyUi(legacyFile)).toEqual({});
});

test("a style of the person's own is read from a file beside the user configuration, and one that cannot be read falls back", async () => {
  fs.writeFileSync(path.join(process.env.JAMCLI_CONFIG_DIR!, 'dots.json'), JSON.stringify({ spinnerFrames: ['.', ':'], shimmerColors: ['#ff0000'] }));
  const ui = { status_spinner_style: 'custom:dots', status_text_style: 'custom:dots', custom_status_styles: { dots: { path: 'dots.json' } } } as const;
  const style = await statusStyleFor(ui, {});
  expect(style.spinnerFrames).toEqual(['.', ':']);
  expect(style.shimmerColors).toEqual(['#ff0000']);
  const missing = await statusStyleFor({ status_spinner_style: 'custom:gone', custom_status_styles: { gone: { path: 'gone.json' } } }, {});
  expect(missing.spinnerStyleId).toBe('classic');
});

test('a tall spinner frame is drawn as its middle row, so the status line stays one line', () => {
  expect(frameRow('⠋')).toBe('⠋');
  expect(frameRow('     \n  ●  \n     ')).toBe('●');
  expect(frameRow('▀▀▀▀▀\n     \n     ')).toBe('▀▀▀▀▀');
  expect(frameRow('top\nmid\nend')).toBe('mid');
});
