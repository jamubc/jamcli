import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig } from '../../config/load.js';
import { OllamaProvider, type PullProgress } from '../../providers/ollama.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { isFirstRun, suggestModel, surveySetup } from '../index.js';

const GB = 1024 ** 3;
let base: string;
let server: FakeProviderServer | undefined;
const saved = { config: process.env.JAMCLI_CONFIG_DIR, anthropic: process.env.ANTHROPIC_API_KEY, openai: process.env.OPENAI_API_KEY, openrouter: process.env.OPENROUTER_API_KEY };

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-onboard-'));
  process.env.JAMCLI_CONFIG_DIR = path.join(base, 'user');
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});
afterEach(() => {
  server?.close();
  server = undefined;
  fs.rmSync(base, { recursive: true, force: true });
  const restore = (name: string, value: string | undefined) => (value === undefined ? delete process.env[name] : (process.env[name] = value));
  restore('JAMCLI_CONFIG_DIR', saved.config);
  restore('ANTHROPIC_API_KEY', saved.anthropic);
  restore('OPENAI_API_KEY', saved.openai);
  restore('OPENROUTER_API_KEY', saved.openrouter);
});

test('the model suggested to pull is the largest that leaves a third of memory free', () => {
  expect(suggestModel(4 * GB)).toBeUndefined();
  expect(suggestModel(8 * GB)?.name).toBe('qwen2.5-coder:3b');
  expect(suggestModel(16 * GB)?.name).toBe('qwen2.5-coder:7b');
  expect(suggestModel(18 * GB)?.name).toBe('qwen2.5-coder:14b');
  expect(suggestModel(32 * GB)?.name).toBe('devstral:24b');
  expect(suggestModel(64 * GB)?.name).toBe('qwen3-coder:30b');
});

test('a first run is one with no user configuration and no model chosen anywhere', () => {
  const project = path.join(base, 'project');
  fs.mkdirSync(project);
  expect(isFirstRun(loadConfig({ projectRoot: project, env: {} }))).toBe(true);
  expect(isFirstRun(loadConfig({ projectRoot: project, env: { JAMCLI_MODEL: 'ollama:qwen3' } }))).toBe(false);
  fs.mkdirSync(path.join(project, '.jamcli'));
  fs.writeFileSync(path.join(project, '.jamcli', 'config.json'), JSON.stringify({ model: 'ollama:qwen3' }));
  expect(isFirstRun(loadConfig({ projectRoot: project, env: {} }))).toBe(false);
  fs.rmSync(path.join(project, '.jamcli'), { recursive: true });
  fs.mkdirSync(process.env.JAMCLI_CONFIG_DIR!, { recursive: true });
  fs.writeFileSync(path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json'), '{}');
  expect(isFirstRun(loadConfig({ projectRoot: project, env: {} }))).toBe(false);
});

test("the survey lists Ollama's models with what they can do, the keys already set, and what to pull", async () => {
  server = startFakeProvider({
    models: [
      { id: 'coder:7b', contextLength: 32768, capabilities: ['completion', 'tools'] },
      { id: 'chat:1b', capabilities: ['completion'] },
    ],
  });
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  const survey = await surveySetup({ registry: { ollama: { endpoint: server.ollamaBaseUrl } }, memoryBytes: 16 * GB });
  expect(survey.ollama).toMatchObject({ endpoint: server.ollamaBaseUrl, reachable: true, pulls: true });
  expect(survey.ollama.models).toEqual([
    { name: 'coder:7b', tools: true, contextWindow: 32768 },
    { name: 'chat:1b', tools: false },
  ]);
  expect(survey.keys).toEqual([{ provider: 'anthropic', detail: 'the ANTHROPIC_API_KEY environment variable' }]);
  expect(JSON.stringify(survey)).not.toContain('sk-test');
  expect(survey.suggestion?.name).toBe('qwen2.5-coder:7b');
});

test('an Ollama that does not answer is named with why, and nothing is suggested to pull', async () => {
  const survey = await surveySetup({ registry: { ollama: { endpoint: 'http://127.0.0.1:9' } }, memoryBytes: 64 * GB, timeoutMs: 2_000 });
  expect(survey.ollama.reachable).toBe(false);
  expect(survey.ollama.problem).toBeTruthy();
  // The reason only; what to do about it is setup's to say.
  expect(survey.ollama.problem).not.toContain('ollama serve');
  expect(survey.suggestion).toBeUndefined();
  expect(survey.keys).toEqual([]);
});

test('a pull reports its steps and leaves the model listed, and an error Ollama reports is its words', async () => {
  server = startFakeProvider();
  const ollama = new OllamaProvider(server.ollamaBaseUrl);
  const steps: PullProgress[] = [];
  await ollama.pull('coder:3b', (step) => steps.push(step));
  expect(steps.at(-1)).toEqual({ status: 'success' });
  expect(steps).toContainEqual({ status: 'pulling coder:3b', total: 1000, completed: 500 });
  expect((await ollama.listModels()).map((model) => model.id)).toContain('coder:3b');
  server.close();

  server = startFakeProvider({ pull: { error: 'pull model manifest: file does not exist' } });
  await expect(new OllamaProvider(server.ollamaBaseUrl).pull('nope:1b')).rejects.toThrow('Ollama could not pull nope:1b: pull model manifest: file does not exist');
});
