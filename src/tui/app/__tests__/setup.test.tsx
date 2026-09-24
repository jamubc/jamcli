import { afterEach, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { frameWith, interfaceHarness } from './harness.js';
import { setupChoices } from '../setup.js';

const GB = 1024 ** 3;
const { context, open } = interfaceHarness({
  models: [
    { id: 'fake-model', contextLength: 32768, capabilities: ['completion', 'tools'] },
    { id: 'coder:7b', contextLength: 65536, capabilities: ['completion', 'tools'] },
    { id: 'chat:1b', capabilities: ['completion'] },
  ],
});
const tall = { width: 120, height: 40 };
const userConfig = () => JSON.parse(fs.readFileSync(path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json'), 'utf8'));
const memory = spyOn(os, 'totalmem').mockReturnValue(16 * GB);
const savedKey = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

test('a first run opens setup: the local models that call tools, and the choice saved for the user only', async () => {
  const { setup, current, close } = await open({}, { size: tall, firstRun: true });
  try {
    const listed = await frameWith(setup, (frame) => frame.includes('ollama:coder:7b'));
    expect(listed).toContain('Set up JamCLI: choose the model to work with');
    expect(listed).toMatch(/ollama:coder:7b\s+on this machine · 65,536-token window · tools/);
    expect(listed).toContain('Download qwen2.5-coder:7b');
    expect(listed).toContain('about 4.7 GB, suggested for 16 GB of memory');
    expect(listed).toContain('1 installed model cannot call tools');
    expect(listed).not.toContain('ollama:chat:1b');
    await setup.mockInput.typeText('coder');
    setup.mockInput.pressEnter();
    const done = await frameWith(setup, (frame) => frame.includes('Permission modes decide') && frame.includes('ollama:coder:7b ·'));
    expect(done).toContain('Model: ollama:coder:7b, saved in');
    expect(done).toContain('Nothing was written to this project.');
    expect(done).toContain('Shift+Tab moves between them');
    expect(current().model).toEqual({ provider: 'ollama', model: 'coder:7b' });
    expect(userConfig().model).toBe('ollama:coder:7b');
    expect(fs.existsSync(path.join(context.root, '.jamcli', 'config.json'))).toBe(false);
  } finally {
    await close();
  }
}, 30_000);

test('setup pulls the model suggested for the memory, says how far it has come, and then uses it', async () => {
  expect(memory).toBeDefined();
  const { setup, current, close } = await open({}, { size: tall, firstRun: true });
  try {
    await frameWith(setup, (frame) => frame.includes('Download qwen2.5-coder:7b'));
    await setup.mockInput.typeText('download');
    setup.mockInput.pressEnter();
    const done = await frameWith(setup, (frame) => frame.includes('Model: ollama:qwen2.5-coder:7b, saved in'));
    expect(done).toContain('Downloading qwen2.5-coder:7b, about 4.7 GB.');
    expect(done).toContain('Downloading qwen2.5-coder:7b: 50%.');
    expect(context.server.requests.some((request) => request.path === '/api/pull' && request.body?.model === 'qwen2.5-coder:7b')).toBe(true);
    expect(current().model.model).toBe('qwen2.5-coder:7b');
    expect(userConfig().model).toBe('ollama:qwen2.5-coder:7b');
  } finally {
    await close();
  }
}, 30_000);

test('setup offers the hosted providers whose key is set, with only that provider\'s models', async () => {
  fs.mkdirSync(path.join(context.root, '.jamcli'));
  fs.writeFileSync(path.join(context.root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { anthropic: { base_url: context.server.anthropicBaseUrl } } }));
  process.env.ANTHROPIC_API_KEY = 'sk-test-onboarding';
  const { setup, current, close } = await open({ env: process.env as Record<string, string> }, { size: tall, firstRun: true });
  try {
    const listed = await frameWith(setup, (frame) => frame.includes('anthropic: choose a model'), 10_000);
    expect(listed).toContain('key from the ANTHROPIC_API_KEY environment variable');
    expect(listed).toContain('ollama:coder:7b');
    expect(listed).not.toContain('sk-test-onboarding');
    await setup.mockInput.typeText('anthropic');
    setup.mockInput.pressEnter();
    const offered = await frameWith(setup, (frame) => frame.includes('Models anthropic offers') && frame.includes('anthropic:coder:7b'));
    expect(offered.slice(offered.indexOf('Models anthropic offers'), offered.indexOf('Escape closes'))).not.toContain('ollama:');
    await setup.mockInput.typeText('coder');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Model: anthropic:coder:7b, saved in'));
    expect(current().model).toEqual({ provider: 'anthropic', model: 'coder:7b' });
    expect(userConfig().model).toBe('anthropic:coder:7b');
  } finally {
    await close();
  }
}, 30_000);

test('with Ollama down, setup says how to start it or which keys to set, in full', async () => {
  fs.mkdirSync(path.join(context.root, '.jamcli'));
  fs.writeFileSync(path.join(context.root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: 'http://127.0.0.1:9' } } }));
  const { setup, close } = await open({}, { size: tall, firstRun: true });
  try {
    const listed = await frameWith(setup, (frame) => frame.includes('Ollama is not answering'), 10_000);
    expect(listed).toContain('Ollama is not answering at http://127.0.0.1:9.');
    expect(listed).toContain('ollama serve');
    // The note wraps rather than being cut, so the last of it is there too.
    expect(listed).toContain('OPENROUTER_API_KEY;');
    expect(listed).not.toContain('Download');
    expect(listed).toMatch(/> Not now/);
  } finally {
    await close();
  }
}, 30_000);

test('Not now saves nothing, and setup is not opened when it is not a first run', async () => {
  const { model, ...rest } = userConfig();
  fs.writeFileSync(path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json'), JSON.stringify(rest));
  const first = await open({}, { size: tall, firstRun: true });
  try {
    await frameWith(first.setup, (frame) => frame.includes('Not now'));
    await first.setup.mockInput.typeText('not now');
    first.setup.mockInput.pressEnter();
    const skipped = await frameWith(first.setup, (frame) => frame.includes('Nothing was saved. /setup opens this again'));
    expect(userConfig().model).toBeUndefined();
    // With no model, the status line says so, and has no window to measure against.
    expect(skipped).toContain('default mode · no model · no sandbox');
    expect(skipped).not.toContain('context');
    expect(model).toBe('ollama:fake-model');
  } finally {
    await first.close();
  }
  const later = await open({}, { size: tall });
  try {
    await Bun.sleep(300);
    await later.setup.renderOnce();
    expect(later.setup.captureCharFrame()).not.toContain('Set up JamCLI');
  } finally {
    await later.close();
  }
}, 30_000);

test('a suggested model already installed is marked, not offered for download', () => {
  const survey = {
    ollama: { endpoint: 'http://localhost:11434', reachable: true, pulls: true, models: [{ name: 'qwen2.5-coder:7b', tools: true }, { name: 'mystery:1b' }] },
    keys: [],
    suggestion: { name: 'qwen2.5-coder:7b', downloadGb: 4.7, memoryGb: 7 },
    memoryBytes: 16 * GB,
  };
  const { items, note } = setupChoices(survey);
  expect(items.map((item) => item.label)).toEqual(['ollama:qwen2.5-coder:7b', 'ollama:mystery:1b', 'Not now']);
  expect(items[0].detail).toBe('on this machine · tools · suggested for this machine');
  expect(items[1].detail).toBe('on this machine · tool support unknown');
  expect(note).toBe('The choice is saved in your user configuration only.');
});
