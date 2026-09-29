import { describe, expect, test } from 'bun:test';
import { SessionController } from '../controller.js';
import type { ViewAction } from '../../state/view.js';
import type { AgentEvent, RunResult } from '../../../core/types.js';

/** A fake runtime whose `run` replays a fixed sequence of events, then returns a result. */
function fakeRuntime(events: AgentEvent[], result: RunResult) {
  return {
    run: async (_text: string, onEvent: (event: AgentEvent) => void) => {
      for (const event of events) onEvent(event);
      return result;
    },
    contextUsage: () => ({ used: 0, budget: 0 }),
    spend: () => ({ requests: 0, cost: 0, unpriced: 0 }),
    model: { provider: '', model: '' },
    thinking: undefined,
    sandbox: { kind: 'none' },
    tools: [],
    lspServers: [],
    permissionMode: 'default',
  } as any;
}

describe('SessionController error deduplication', () => {
  test('does not repeat a result error already shown as a notice', async () => {
    const message = "ollama returned 404: model 'qwen3' not found";
    const runtime = fakeRuntime([{ type: 'notice', level: 'error', message }], { status: 'error', error: message } as RunResult);
    const actions: ViewAction[] = [];
    const controller = new SessionController(runtime, (action) => actions.push(action));

    await controller.submit('hi');

    const errorNotices = actions.filter(
      (action) => (action.type === 'notice' && action.level === 'error') || (action.type === 'event' && action.event.type === 'notice' && action.event.level === 'error')
    );
    expect(errorNotices).toHaveLength(1);
  });

  test('still shows a result error that was never shown as a notice', async () => {
    const message = 'a different failure';
    const runtime = fakeRuntime([], { status: 'error', error: message } as RunResult);
    const actions: ViewAction[] = [];
    const controller = new SessionController(runtime, (action) => actions.push(action));

    await controller.submit('hi');

    const errorNotices = actions.filter(
      (action) => (action.type === 'notice' && action.level === 'error') || (action.type === 'event' && action.event.type === 'notice' && action.event.level === 'error')
    );
    expect(errorNotices).toHaveLength(1);
  });
});

describe('SessionController work watching', () => {
  test('a background child that spends between turns moves the status cost with its work', () => {
    let cost = 0.01;
    let listener: () => void = () => undefined;
    const runtime = { ...fakeRuntime([], { status: 'ok' } as RunResult), spend: () => ({ requests: 1, cost, unpriced: 0 }), work: () => [], watchWork: (next: () => void) => ((listener = next), () => undefined) };
    const actions: ViewAction[] = [];
    const stop = new SessionController(runtime, (action) => actions.push(action)).watchWork();
    cost = 0.05;
    listener();
    const patches = actions.filter((action) => action.type === 'status').map((action: any) => action.patch.costUsd);
    expect(patches).toEqual([0.01, 0.05]);
    stop();
  });
});

describe('SessionController context share', () => {
  test('the share follows what each request of the session carried, since the runtime keeps the conversation only at the end of the turn', async () => {
    // The runtime's own count holds still through the turn, as the real one does.
    const request = (prompt: number, completion: number, extra = {}): AgentEvent => ({ type: 'usage', usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }, model: 'p:m', ...extra });
    const runtime = {
      ...fakeRuntime([], { status: 'ok' } as RunResult),
      run: async (_text: string, onEvent: (event: AgentEvent) => void) => {
        onEvent(request(400, 0));
        onEvent(request(850, 50));
        // Neither a child's request, nor another model's, nor one with no counts is the session's own.
        onEvent(request(5_000, 0, { delegatedSession: 'child-1' }));
        onEvent(request(700, 0, { model: 'trust:judge' }));
        onEvent(request(0, 0, { unreported: true }));
        return { status: 'ok' } as RunResult;
      },
      contextUsage: () => ({ used: 100, budget: 1_000 }),
      model: { provider: 'p', model: 'm' },
      thinking: {},
    } as any;
    const actions: ViewAction[] = [];
    await new SessionController(runtime, (action) => actions.push(action)).submit('go');
    const shares = actions.filter((action: any) => action.type === 'status' && action.patch.contextPercent !== undefined).map((action: any) => action.patch.contextPercent);
    // Two of the session's own requests, then the end of the turn reads the runtime once more.
    expect(shares).toEqual([40, 90, 10]);
  });
});
