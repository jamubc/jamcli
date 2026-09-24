import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { ConfigFileSchema, McpFileSchema, ProfileSchema } from '../schema.js';
import { formatPath, validateLayer } from '../validate.js';
import { SCHEMA_FILE, renderConfigSchema } from '../writeSchema.js';

const repoRoot = path.resolve(import.meta.dir, '../../../..');

test('the checked-in JSON schema is the one the Zod schemas generate', () => {
  // After a schema change, `bun run config-schema` regenerates it.
  expect(fs.readFileSync(path.join(repoRoot, SCHEMA_FILE), 'utf8')).toBe(renderConfigSchema());
  const schema = JSON.parse(renderConfigSchema());
  expect(schema.additionalProperties).toBe(false);
  expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['model', 'api_registry', 'permissions', 'sandbox', 'models', 'context']));
});

test('a configuration using every section is accepted as written', () => {
  const config = {
    $schema: '../docs/config.schema.json',
    model: 'anthropic:claude-opus-5-5',
    active_profile: 'default',
    api_registry: {
      ollama: { endpoint: 'http://localhost:11434', num_ctx: 32768 },
      anthropic: { key_env_var: 'ANTHROPIC_API_KEY' },
      endpoints: [{ id: 'gateway', base_url: 'https://gw.example/v1', dialect: 'openai', headers: { 'X-Team': 'a' } }],
    },
    models: { 'ollama:qwen2.5-coder:7b': { context_window: 32768, price: { input: 0, output: 0 } } },
    permissions: { allow: ['read_file'], deny: ['run_command(rm *)'], mode: 'accept-edits' },
    sandbox: { network: false, writable: ['/var/tmp'], env: 'minimal' },
    agent_loop: { max_steps: 40, max_output_tokens: 16000 },
    context: { auto_compact: true },
    categories: { quick: [{ model: 'ollama:qwen2.5-coder:7b' }] },
    delegation: { max_depth: 1 },
    trust: { enabled: false },
    telemetry: false,
  };
  expect(validateLayer(ConfigFileSchema, config, 'config.json')).toEqual({ value: config as any, errors: [] });
});

test('a value that does not fit is named by file, key, and expected shape, and the rest still applies', () => {
  const { value, errors } = validateLayer(
    ConfigFileSchema,
    {
      agent_loop: { max_steps: 'ten', max_output_tokens: 8000 },
      modle: 'typo',
      permissions: { mode: 'yolo', allow: ['grep'] },
      api_registry: { openrouter: { api_key: ['sk-or-secret-value'] }, anthropic: { key_env_var: 'ANTHROPIC_API_KEY' } },
    },
    '.jamcli/config.json'
  );
  // In the schema's order, then the keys it does not know.
  expect(errors).toEqual([
    '.jamcli/config.json api_registry.openrouter.api_key should be a string, so it is ignored.',
    '.jamcli/config.json permissions.mode should be one of "plan", "default", "accept-edits", "auto", "bypass", so it is ignored.',
    '.jamcli/config.json agent_loop.max_steps should be a whole number above zero, so it is ignored.',
    '.jamcli/config.json: modle is not a setting JamCLI knows, so it is ignored.',
  ]);
  expect(value).toEqual({
    agent_loop: { max_output_tokens: 8000 },
    permissions: { allow: ['grep'] },
    api_registry: { anthropic: { key_env_var: 'ANTHROPIC_API_KEY' } },
  });
  // A misplaced key is never quoted back.
  expect(errors.join('\n')).not.toContain('sk-or-secret');
});

test('an entry missing what it needs is left out whole, and odd keys are quoted', () => {
  const { value, errors } = validateLayer(
    ConfigFileSchema,
    {
      api_registry: { endpoints: [{ id: 'broken' }, { id: 'ok', base_url: 'https://ok.example/v1' }] },
      models: { 'ollama:qwen2.5-coder:7b': { context_window: 0 } },
    },
    'config.json'
  );
  expect(errors).toEqual([
    'config.json api_registry.endpoints[0].base_url should be a string, so it is ignored.',
    'config.json models["ollama:qwen2.5-coder:7b"].context_window should be a whole number above zero, so it is ignored.',
  ]);
  expect(value).toEqual({ api_registry: { endpoints: [{ id: 'ok', base_url: 'https://ok.example/v1' }] }, });
  expect(formatPath(['a', 0, 'b-c', 'd'])).toBe('a[0]["b-c"].d');
});

test('a file that is not an object is ignored whole, and a single value is named by its variable', () => {
  expect(validateLayer(ConfigFileSchema, ['model'], 'config.json')).toEqual({ errors: ['config.json should hold an object, so it is ignored.'] });
  expect(validateLayer(ConfigFileSchema, { permissions: { mode: 'yolo' } }, 'JAMCLI_PERMISSION_MODE', { single: true }).errors).toEqual([
    'JAMCLI_PERMISSION_MODE should be one of "plan", "default", "accept-edits", "auto", "bypass", so it is ignored.',
  ]);
});

test('profiles and the legacy mcp.json have schemas too, and mcp.json keeps keys it does not know', () => {
  expect(validateLayer(ProfileSchema, { temperature: 3 }, 'profiles/default.json').errors).toEqual([
    'profiles/default.json temperature should be a number of at most 2, so it is ignored.',
  ]);
  const mcp = { servers: [{ id: 'fs', command: 'npx', note: 'kept' }], tools: { read_file: { allowed: true }, grep: false }, extra: 1 };
  expect(validateLayer(McpFileSchema, mcp, '.jamcli/mcp.json')).toEqual({ value: mcp, errors: [] });
});
