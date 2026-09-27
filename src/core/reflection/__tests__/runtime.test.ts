import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../../runtime/index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { AgentEvent, ToolResult } from '../../types.js';
import { REFLECTION_TOOLS } from '../tools.js';

let server: FakeProviderServer;
let root: string;
let saved: Record<string, string | undefined>;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-reflection-')));
  saved = { JAMCLI_STATE_DIR: process.env.JAMCLI_STATE_DIR, JAMCLI_CONFIG_DIR: process.env.JAMCLI_CONFIG_DIR };
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  process.env.JAMCLI_CONFIG_DIR = path.join(root, '.user');
  fs.mkdirSync(path.join(root, '.user'), { recursive: true });
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, active_profile: 'default', trust: { enabled: false }, sandbox: { enabled: false } })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Rules\n\n## Editing\n\n- Keep changes small.\n');
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

/** A reflection turn, as /reflect sends it: the only kind that is offered the reflection tools. */
async function turn(runtime: Awaited<ReturnType<typeof createRuntime>>, prompt: string, allow = true) {
  const events: AgentEvent[] = [];
  await runtime.run(
    prompt,
    (event) => {
      events.push(event);
      if (event.type === 'approval_request') event.decide({ allow, scope: 'once' });
    },
    { offer: REFLECTION_TOOLS, label: '/reflect' }
  );
  return {
    results: events.flatMap((event) => (event.type === 'tool_result' ? [event.result] : [])) as ToolResult[],
    asked: events.flatMap((event) => (event.type === 'approval_request' ? [event] : [])),
  };
}

const lesson = (id: string, cites: number[]) => ({
  id,
  name: 'propose_lesson',
  arguments: { finding: 'I edited text that was not there.', cites, file: 'AGENTS.md', section: 'Editing', add: '- Read a file before editing it; an edit on unseen text fails.' },
});

test('a failure becomes a lesson only with a real citation and the person\'s approval', async () => {
  const runtime = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false, allowTools: ['edit'] });

  server.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'missing', replace_string: 'x' } }] }, { text: 'failed' });
  await turn(runtime, 'change it');

  server.enqueue({ toolCalls: [{ id: 's1', name: 'session_signals', arguments: {} }] }, { text: 'seen' });
  const signals = (await turn(runtime, 'reflect')).results[0].output;
  const id = Number(/\[(\d+)\] tool_error/.exec(signals)?.[1]);
  expect(Number.isInteger(id)).toBe(true);

  server.enqueue({ toolCalls: [lesson('l1', [id + 1000])] }, { text: 'refused' });
  const invented = await turn(runtime, 'propose');
  expect(invented.asked).toHaveLength(0);
  expect(invented.results[0].status).toBe('denied');

  server.enqueue({ toolCalls: [lesson('l2', [id])] }, { text: 'proposed' });
  const cited = await turn(runtime, 'propose');
  expect(cited.asked).toHaveLength(1);
  expect(cited.asked[0].request?.preview?.text).toContain('+- Read a file before editing it');
  expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toBe('# Rules\n\n## Editing\n\n- Keep changes small.\n- Read a file before editing it; an edit on unseen text fails.\n');
});

test('a declined lesson writes nothing', async () => {
  const runtime = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false, allowTools: ['edit'] });
  server.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'missing', replace_string: 'x' } }] }, { text: 'failed' });
  await turn(runtime, 'change it');
  server.enqueue({ toolCalls: [{ id: 's1', name: 'session_signals', arguments: {} }] }, { text: 'seen' });
  const id = Number(/\[(\d+)\] tool_error/.exec((await turn(runtime, 'reflect')).results[0].output)?.[1]);
  // A person's no ends the step, so nothing follows the proposal.
  server.enqueue({ toolCalls: [lesson('l1', [id])] });
  await turn(runtime, 'propose', false);
  expect(server.pending()).toBe(0);
  expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toBe('# Rules\n\n## Editing\n\n- Keep changes small.\n');
});

test('an ordinary turn is not offered the reflection tools, and cannot call them', async () => {
  const runtime = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false });
  server.enqueue({ toolCalls: [{ id: 's1', name: 'session_signals', arguments: {} }] }, { text: 'done' });
  const events: AgentEvent[] = [];
  await runtime.run('look around', (event) => events.push(event));
  const request = server.completions().at(-2)!;
  const offered = request.body.tools.map((tool: any) => tool.function.name);
  for (const name of REFLECTION_TOOLS) expect(offered).not.toContain(name);
  const result = events.flatMap((event) => (event.type === 'tool_result' ? [event.result] : []))[0];
  expect(result.success).toBe(false);
  // The next reflection turn is offered them again.
  server.enqueue({ text: 'nothing to learn' });
  await turn(runtime, 'reflect');
  const next = server.completions().at(-1)!.body.tools.map((tool: any) => tool.function.name);
  for (const name of REFLECTION_TOOLS) expect(next).toContain(name);
});
