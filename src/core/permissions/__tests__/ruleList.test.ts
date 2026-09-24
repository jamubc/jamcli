import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { editRuleList } from '../grants.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-rulelist-'));
  file = path.join(dir, 'nested', 'config.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));

test('adding keeps the rest of the file and each rule once', () => {
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ theme: 'dark', permissions: { mode: 'plan', allow: ['grep'] } }));
  expect(editRuleList(file, 'config.json', 'allow', ['grep', 'glob'], 'add')).toBe(true);
  expect(read()).toEqual({ theme: 'dark', permissions: { mode: 'plan', allow: ['grep', 'glob'] } });
  expect(editRuleList(file, 'config.json', 'deny', ['run_command(rm *)'], 'add')).toBe(true);
  expect(read().permissions.deny).toEqual(['run_command(rm *)']);
});

test('a change that changes nothing writes nothing, and makes no file', () => {
  expect(editRuleList(file, 'config.json', 'allow', ['grep'], 'remove')).toBe(false);
  expect(fs.existsSync(file)).toBe(false);
  editRuleList(file, 'config.json', 'allow', ['grep'], 'add');
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace('\n', '\n\n'));
  expect(editRuleList(file, 'config.json', 'allow', ['grep'], 'add')).toBe(false);
  expect(editRuleList(file, 'config.json', 'ask', ['grep'], 'remove')).toBe(false);
  expect(fs.readFileSync(file, 'utf8')).toBe(text.replace('\n', '\n\n'));
});

test('a file that is not JSON is left alone, and the error says what did not happen', () => {
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, '{ nope');
  expect(() => editRuleList(file, '.jamcli/config.json', 'allow', ['grep'], 'add')).toThrow(/^\.jamcli\/config\.json is not valid JSON, so it was not changed: /);
  expect(() => editRuleList(file, 'x', 'allow', ['grep'], 'add', 'the grant was not saved')).toThrow(/so the grant was not saved/);
  expect(fs.readFileSync(file, 'utf8')).toBe('{ nope');
});
