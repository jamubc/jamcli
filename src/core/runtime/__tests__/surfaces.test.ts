import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startFakeProvider, type FakeProviderServer, type ScriptedTurn } from '../../../testing/fakeProvider.js';
import { runHeadless } from '../../../cli/run.js';
import { createAcpSession } from '../../../acp/session.js';
import { createInterfaceRuntime } from '../../../tui/runtime.js';
import { SessionLog, type TranscriptEvent } from '../../transcript/index.js';
import type { AgentEvent } from '../../types.js';
import type { McpSource } from '../tools.js';

/**
 * One scripted conversation through each surface's own assembly call. The surfaces may
 * differ in how they present events and who answers an approval, and in nothing else.
 */

let server: FakeProviderServer;
let root: string;
let previousState: string | undefined;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-surfaces-'));
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } } }));
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Keep answers short.\n');
});

afterEach(() => {
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
});

/** A tool registered by an MCP server, which every surface must offer unchanged. */
const mcp: McpSource = {
  listServers: async () => [{ id: 'docs', command: 'unused' }],
  listServerTools: async () => [
    {
      name: 'docs__lookup',
      nativeName: 'lookup',
      description: 'Look up a documentation page.',
      inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
      source: 'server',
      serverId: 'docs',
      annotations: { readOnlyHint: true },
    },
  ],
  callServerTool: async (_tool, args) => ({ output: `page about ${args.topic}` }),
};

const script = (): ScriptedTurn[] => [
  {
    text: 'Looking.',
    toolCalls: [
      { id: 'r1', name: 'read_file', arguments: { path: 'a.txt' } },
      { id: 'd1', name: 'docs__lookup', arguments: { topic: 'edits' } },
    ],
  },
  { toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } }] },
  { text: 'Done.' },
];

const PROMPT = 'update @a.txt';

/** Each surface answers approvals its own way; a person allowing is modeled as `decide(true)`. */
const allow = (event: AgentEvent) => {
  if (event.type === 'approval_request') event.decide(true);
};

const surfaces: Record<string, () => Promise<string>> = {
  headless: async () =>
    (await runHeadless({ prompt: PROMPT, projectRoot: root, allowTools: ['edit'], runtime: { mcp } })).sessionId,
  acp: async () => {
    const session = await createAcpSession({ projectRoot: root, cwd: root, runtime: { mcp } });
    await session.run(PROMPT, allow);
    await session.close?.();
    return session.id;
  },
  tui: async () => {
    const runtime = await createInterfaceRuntime({ projectRoot: root, mcp });
    await runtime.run(PROMPT, allow);
    await runtime.close();
    return runtime.sessionId;
  },
};

/** A transcript without what may differ: ids, timestamps, and who decided on which surface. */
const comparable = (events: TranscriptEvent[]) =>
  events.map((event) => {
    const { ts: _ts, ...rest } = event as TranscriptEvent & Record<string, unknown>;
    if (event.type === 'session') return { type: 'session' };
    if (event.type === 'message') {
      const { timestamp: _time, ...message } = event.message;
      return { ...rest, message };
    }
    if (event.type === 'approval') return { type: 'approval', callId: event.callId, tool: event.tool, allow: event.allow };
    return rest;
  });

test('the same conversation sends the same requests and records the same transcript on every surface', async () => {
  const requests: Record<string, unknown[]> = {};
  const transcripts: Record<string, unknown[]> = {};
  for (const [name, run] of Object.entries(surfaces)) {
    fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
    server.enqueue(...script());
    const before = server.completions().length;
    const sessionId = await run();
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('new\n');
    requests[name] = server.completions().slice(before).map((request) => request.body);
    transcripts[name] = comparable(SessionLog.open(root, sessionId).events());
  }

  expect(requests.headless).toHaveLength(3);
  expect(requests.acp).toEqual(requests.headless);
  expect(requests.tui).toEqual(requests.headless);
  expect(transcripts.acp).toEqual(transcripts.headless);
  expect(transcripts.tui).toEqual(transcripts.headless);

  const tools = (requests.headless[0] as any).tools.map((tool: any) => tool.function.name);
  expect(tools).toContain('docs__lookup');
  expect(tools).toContain('edit');
  const first = requests.headless[0] as any;
  expect(first.messages[0].content).toContain('Keep answers short.');
  expect(first.messages[1].content).toContain('File a.txt');
});

test('each surface records itself as the one that decided', async () => {
  const deciders: Record<string, unknown> = {};
  for (const [name, run] of Object.entries(surfaces)) {
    fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
    server.enqueue(...script());
    const events = SessionLog.open(root, await run()).events();
    const approval = events.find((event) => event.type === 'approval');
    deciders[name] = approval && { surface: approval.surface, by: approval.by };
  }
  expect(deciders).toEqual({
    headless: { surface: 'headless', by: 'flag' },
    acp: { surface: 'acp', by: 'user' },
    tui: { surface: 'tui', by: 'user' },
  });
});
