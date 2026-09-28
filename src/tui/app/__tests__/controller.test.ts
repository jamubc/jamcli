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
