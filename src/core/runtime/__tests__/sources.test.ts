import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { registerSkills, sessionMcp, sessionPlugins } from '../sources.js';
import type { McpSource } from '../tools.js';
import type { Rule } from '../../permissions/rules.js';
import { createBuiltinRegistry } from '../../tools/registry.js';

let dir: string;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-sources-')));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const envFor = () => ({ PATH: process.env.PATH ?? '' });

test("a skill's allowed-tools narrow through the session, and the model reads what then holds", async () => {
  const skill = path.join(dir, '.agents', 'skills', 'look');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: look\ndescription: Look only.\nallowed-tools: Read Grep\n---\nOnly read.\n');
  const registry = createBuiltinRegistry();
  const narrowed: { rules: string[]; label: string }[] = [];
  const found = registerSkills(registry, dir, (rules: Rule[], label) => {
    narrowed.push({ rules: rules.map((rule) => rule.text), label });
    return rules.slice(0, 1);
  });
  expect(found.skills.map((entry) => entry.name)).toEqual(['look']);
  const result = await registry.get('skill')!.runner({ name: 'look' }, { projectRoot: dir } as never);
  expect(narrowed).toEqual([{ rules: ['read_file', 'grep'], label: 'the skill look' }]);
  expect(result.output).toContain('While this skill is active, until this turn ends, only these tools may run: read_file.');

  // With no skills there is no tool.
  const empty = createBuiltinRegistry();
  expect(registerSkills(empty, path.join(dir, 'nothing'), () => []).skills).toEqual([]);
  expect(empty.get('skill')).toBeUndefined();
});

test('with no plugins and no servers, a session loads neither, and a given source is used as it is', async () => {
  expect(await sessionPlugins({ projectRoot: dir, verify: true, sandboxSettings: {}, envFor })).toEqual({ plugins: { processes: [], servers: [], notices: [] }, notices: [] });
  const common = { projectRoot: dir, pluginServers: [], env: process.env, envFor, elicit: async () => ({ action: 'decline' as const }) };
  expect(await sessionMcp({ ...common, given: undefined, servers: [] })).toBeUndefined();
  expect(await sessionMcp({ ...common, given: undefined, servers: [{ id: 'off', command: 'x', enabled: false }] })).toBeUndefined();
  expect(await sessionMcp({ ...common, given: false, servers: [{ id: 'on', command: 'x' }] })).toBeUndefined();
  const given = { listServers: async () => [] } as unknown as McpSource;
  expect(await sessionMcp({ ...common, given, servers: [] })).toBe(given);
});
