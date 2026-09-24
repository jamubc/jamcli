/**
 * A scripted model server for tests. It speaks the three wire formats JamCLI talks to:
 * OpenAI chat completions, Anthropic messages, and Ollama's native chat route, in both
 * streaming and non-streaming modes. Each request consumes the next scripted turn, and
 * every request body is captured so a test can assert on exactly what was sent.
 *
 * Streaming output mirrors the real services closely enough to exercise chunk handling:
 * text and arguments are split across events, tool calls arrive incrementally, and usage
 * arrives where each service puts it.
 */

export type Dialect = 'openai' | 'anthropic' | 'ollama';

export interface ScriptedToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ScriptedTurn {
  text?: string;
  reasoning?: string;
  /** Signature attached to the reasoning block (Anthropic only). */
  reasoningSignature?: string;
  toolCalls?: ScriptedToolCall[];
  /**
   * `prompt` is the whole prompt, cache reads and writes included, as OpenAI counts it.
   * Anthropic reports the cache parts beside a smaller `input_tokens`, and the fake does too.
   */
  usage?: { prompt: number; completion: number; cacheRead?: number; cacheWrite?: number };
  /** Respond with this HTTP status instead of a completion. */
  status?: number;
  /** Body sent with a non-200 status. */
  errorBody?: unknown;
  headers?: Record<string, string>;
  /** Wait this long before responding. */
  delayMs?: number;
  /** Characters per streamed text chunk. Defaults to 4. */
  chunkSize?: number;
  /** Close the stream after this many events, without a terminal event. */
  cutAfterEvents?: number;
  /** The stop reason to report in the dialect's own field, such as `max_tokens` or `length`. */
  stopReason?: string;
}

export interface CapturedRequest {
  dialect: Dialect | 'models';
  method: string;
  path: string;
  headers: Record<string, string>;
  body: any;
}

export interface FakeModel {
  id: string;
  contextLength?: number;
  /** Price per token, as OpenRouter reports it. */
  pricing?: { prompt: string; completion: string };
  capabilities?: string[];
  /**
   * Fields added to this model's entry on `/v1/models` and to the single-model route
   * `/v1/models/{id}`, so a test can serve any provider's metadata shape verbatim.
   */
  metadata?: Record<string, unknown>;
}

export interface FakeProviderOptions {
  models?: FakeModel[];
}

export interface FakeProviderServer {
  readonly url: string;
  readonly openaiBaseUrl: string;
  readonly anthropicBaseUrl: string;
  readonly ollamaBaseUrl: string;
  readonly requests: CapturedRequest[];
  /** Requests that asked for a completion, in order. */
  completions(): CapturedRequest[];
  enqueue(...turns: ScriptedTurn[]): void;
  pending(): number;
  close(): void;
}

const DEFAULT_MODELS: FakeModel[] = [
  { id: 'fake-model', contextLength: 32768, capabilities: ['completion', 'tools'] },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const split = (text: string, size: number): string[] => {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
};

/** Anthropic's input counts: uncached input beside the cache reads and writes. */
const anthropicInput = (turn: ScriptedTurn) => {
  const read = turn.usage?.cacheRead ?? 0;
  const write = turn.usage?.cacheWrite ?? 0;
  return {
    input_tokens: (turn.usage?.prompt ?? 0) - read - write,
    ...(read ? { cache_read_input_tokens: read } : {}),
    ...(write ? { cache_creation_input_tokens: write } : {}),
  };
};

const callId = (dialect: Dialect, index: number, call: ScriptedToolCall) =>
  call.id ?? (dialect === 'anthropic' ? `toolu_fake_${index}` : `call_fake_${index}`);

/** Serialize a list of events as a streamed response body, optionally cut short. */
const streamBody = (events: string[], turn: ScriptedTurn): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const limit = turn.cutAfterEvents ?? events.length;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < Math.min(limit, events.length); i += 1) {
        controller.enqueue(encoder.encode(events[i]));
      }
      controller.close();
    },
  });
};

const openaiStreamEvents = (turn: ScriptedTurn, model: string, includeUsage: boolean): string[] => {
  const size = turn.chunkSize ?? 4;
  const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    frame({
      id: 'chatcmpl-fake',
      object: 'chat.completion.chunk',
      created: 0,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    });

  const events: string[] = [chunk({ role: 'assistant', content: '' })];
  for (const part of split(turn.reasoning ?? '', size)) events.push(chunk({ reasoning: part }));
  for (const part of split(turn.text ?? '', size)) events.push(chunk({ content: part }));
  (turn.toolCalls ?? []).forEach((call, index) => {
    events.push(
      chunk({
        tool_calls: [
          { index, id: callId('openai', index, call), type: 'function', function: { name: call.name, arguments: '' } },
        ],
      })
    );
    for (const part of split(JSON.stringify(call.arguments), size)) {
      events.push(chunk({ tool_calls: [{ index, function: { arguments: part } }] }));
    }
  });
  events.push(chunk({}, turn.stopReason ?? (turn.toolCalls?.length ? 'tool_calls' : 'stop')));
  if (includeUsage && turn.usage) {
    events.push(
      frame({
        id: 'chatcmpl-fake',
        object: 'chat.completion.chunk',
        created: 0,
        model,
        choices: [],
        usage: {
          prompt_tokens: turn.usage.prompt,
          completion_tokens: turn.usage.completion,
          total_tokens: turn.usage.prompt + turn.usage.completion,
          ...(turn.usage.cacheRead ? { prompt_tokens_details: { cached_tokens: turn.usage.cacheRead } } : {}),
        },
      })
    );
  }
  events.push('data: [DONE]\n\n');
  return events;
};

const openaiJson = (turn: ScriptedTurn, model: string) => ({
  id: 'chatcmpl-fake',
  object: 'chat.completion',
  created: 0,
  model,
  choices: [
    {
      index: 0,
      finish_reason: turn.stopReason ?? (turn.toolCalls?.length ? 'tool_calls' : 'stop'),
      message: {
        role: 'assistant',
        content: turn.text ?? '',
        ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
        ...(turn.toolCalls?.length
          ? {
              tool_calls: turn.toolCalls.map((call, index) => ({
                id: callId('openai', index, call),
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      },
    },
  ],
  ...(turn.usage
    ? {
        usage: {
          prompt_tokens: turn.usage.prompt,
          completion_tokens: turn.usage.completion,
          total_tokens: turn.usage.prompt + turn.usage.completion,
          ...(turn.usage.cacheRead ? { prompt_tokens_details: { cached_tokens: turn.usage.cacheRead } } : {}),
        },
      }
    : {}),
});

const anthropicStreamEvents = (turn: ScriptedTurn, model: string): string[] => {
  const size = turn.chunkSize ?? 4;
  const frame = (type: string, payload: Record<string, unknown>) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
  const events: string[] = [
    frame('message_start', {
      message: {
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        usage: { ...anthropicInput(turn), output_tokens: 1 },
      },
    }),
  ];
  let index = 0;
  if (turn.reasoning) {
    events.push(frame('content_block_start', { index, content_block: { type: 'thinking', thinking: '' } }));
    for (const part of split(turn.reasoning, size)) {
      events.push(frame('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: part } }));
    }
    if (turn.reasoningSignature) {
      events.push(
        frame('content_block_delta', { index, delta: { type: 'signature_delta', signature: turn.reasoningSignature } })
      );
    }
    events.push(frame('content_block_stop', { index }));
    index += 1;
  }
  if (turn.text) {
    events.push(frame('content_block_start', { index, content_block: { type: 'text', text: '' } }));
    for (const part of split(turn.text, size)) {
      events.push(frame('content_block_delta', { index, delta: { type: 'text_delta', text: part } }));
    }
    events.push(frame('content_block_stop', { index }));
    index += 1;
  }
  (turn.toolCalls ?? []).forEach((call, callIndex) => {
    events.push(
      frame('content_block_start', {
        index,
        content_block: { type: 'tool_use', id: callId('anthropic', callIndex, call), name: call.name, input: {} },
      })
    );
    for (const part of split(JSON.stringify(call.arguments), size)) {
      events.push(frame('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: part } }));
    }
    events.push(frame('content_block_stop', { index }));
    index += 1;
  });
  events.push(
    frame('message_delta', {
      delta: { stop_reason: turn.stopReason ?? (turn.toolCalls?.length ? 'tool_use' : 'end_turn'), stop_sequence: null },
      usage: { output_tokens: turn.usage?.completion ?? 0 },
    })
  );
  events.push(frame('message_stop', {}));
  return events;
};

const anthropicJson = (turn: ScriptedTurn, model: string) => {
  const content: Record<string, unknown>[] = [];
  if (turn.reasoning) {
    content.push({ type: 'thinking', thinking: turn.reasoning, signature: turn.reasoningSignature ?? '' });
  }
  if (turn.text) content.push({ type: 'text', text: turn.text });
  (turn.toolCalls ?? []).forEach((call, index) =>
    content.push({ type: 'tool_use', id: callId('anthropic', index, call), name: call.name, input: call.arguments })
  );
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: turn.stopReason ?? (turn.toolCalls?.length ? 'tool_use' : 'end_turn'),
    usage: { ...anthropicInput(turn), output_tokens: turn.usage?.completion ?? 0 },
  };
};

/**
 * Ollama streams newline-delimited JSON. Since Ollama 0.8, tool calls arrive in a
 * non-final chunk as soon as they are parsed, and the final chunk carries only the
 * counts, so a client that reads tool calls from the final chunk alone misses them.
 */
const ollamaStreamEvents = (turn: ScriptedTurn, model: string): string[] => {
  const size = turn.chunkSize ?? 4;
  const line = (payload: unknown) => `${JSON.stringify(payload)}\n`;
  const base = { model, created_at: '2026-01-01T00:00:00Z' };
  const events: string[] = [];
  for (const part of split(turn.reasoning ?? '', size)) {
    events.push(line({ ...base, message: { role: 'assistant', content: '', thinking: part }, done: false }));
  }
  for (const part of split(turn.text ?? '', size)) {
    events.push(line({ ...base, message: { role: 'assistant', content: part }, done: false }));
  }
  if (turn.toolCalls?.length) {
    events.push(
      line({
        ...base,
        message: {
          role: 'assistant',
          content: '',
          tool_calls: turn.toolCalls.map((call, index) => ({
            ...(call.id ? { id: call.id } : {}),
            function: { index, name: call.name, arguments: call.arguments },
          })),
        },
        done: false,
      })
    );
  }
  events.push(
    line({
      ...base,
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: turn.stopReason ?? 'stop',
      prompt_eval_count: turn.usage?.prompt ?? 0,
      eval_count: turn.usage?.completion ?? 0,
    })
  );
  return events;
};

const ollamaJson = (turn: ScriptedTurn, model: string) => ({
  model,
  created_at: '2026-01-01T00:00:00Z',
  message: {
    role: 'assistant',
    content: turn.text ?? '',
    ...(turn.reasoning ? { thinking: turn.reasoning } : {}),
    ...(turn.toolCalls?.length
      ? {
          tool_calls: turn.toolCalls.map((call, index) => ({
            ...(call.id ? { id: call.id } : {}),
            function: { index, name: call.name, arguments: call.arguments },
          })),
        }
      : {}),
  },
  done: true,
  done_reason: turn.stopReason ?? 'stop',
  prompt_eval_count: turn.usage?.prompt ?? 0,
  eval_count: turn.usage?.completion ?? 0,
});

const headersOf = (request: Request): Record<string, string> => {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
};

export function startFakeProvider(options: FakeProviderOptions = {}): FakeProviderServer {
  const models = options.models ?? DEFAULT_MODELS;
  const queue: ScriptedTurn[] = [];
  const requests: CapturedRequest[] = [];

  const errorResponse = (turn: ScriptedTurn) =>
    new Response(JSON.stringify(turn.errorBody ?? { error: { message: `scripted status ${turn.status}` } }), {
      status: turn.status,
      headers: { 'content-type': 'application/json', ...(turn.headers ?? {}) },
    });

  const nextTurn = (): ScriptedTurn => {
    const turn = queue.shift();
    if (!turn) {
      return { status: 500, errorBody: { error: { message: 'fake provider: no scripted turn left' } } };
    }
    return turn;
  };

  const complete = async (dialect: Dialect, body: any): Promise<Response> => {
    const turn = nextTurn();
    if (turn.delayMs) await sleep(turn.delayMs);
    if (turn.status && turn.status !== 200) return errorResponse(turn);
    const model = String(body?.model ?? 'fake-model');
    const extra = turn.headers ?? {};

    if (dialect === 'openai') {
      if (body?.stream) {
        const includeUsage = Boolean(body?.stream_options?.include_usage);
        return new Response(streamBody(openaiStreamEvents(turn, model, includeUsage), turn), {
          headers: { 'content-type': 'text/event-stream', ...extra },
        });
      }
      return Response.json(openaiJson(turn, model), { headers: extra });
    }
    if (dialect === 'anthropic') {
      if (body?.stream) {
        return new Response(streamBody(anthropicStreamEvents(turn, model), turn), {
          headers: { 'content-type': 'text/event-stream', ...extra },
        });
      }
      return Response.json(anthropicJson(turn, model), { headers: extra });
    }
    if (body?.stream === false) {
      return Response.json(ollamaJson(turn, model), { headers: extra });
    }
    return new Response(streamBody(ollamaStreamEvents(turn, model), turn), {
      headers: { 'content-type': 'application/x-ndjson', ...extra },
    });
  };

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
      const record = (dialect: CapturedRequest['dialect']) =>
        requests.push({ dialect, method: request.method, path, headers: headersOf(request), body });

      if (request.method === 'POST' && path === '/v1/chat/completions') {
        record('openai');
        return complete('openai', body);
      }
      if (request.method === 'POST' && path === '/v1/messages') {
        record('anthropic');
        return complete('anthropic', body);
      }
      if (request.method === 'POST' && path === '/api/chat') {
        record('ollama');
        return complete('ollama', body);
      }
      if (request.method === 'GET' && path === '/v1/models') {
        record('models');
        return Response.json({
          data: models.map((model) => ({
            id: model.id,
            ...(model.contextLength ? { context_length: model.contextLength } : {}),
            ...(model.pricing ? { pricing: model.pricing } : {}),
            ...(model.capabilities?.includes('tools') ? { supported_parameters: ['tools', 'tool_choice'] } : {}),
            ...(model.metadata ?? {}),
          })),
        });
      }
      if (request.method === 'GET' && path.startsWith('/v1/models/')) {
        record('models');
        const id = decodeURIComponent(path.slice('/v1/models/'.length));
        const model = models.find((entry) => entry.id === id);
        if (!model) return Response.json({ type: 'error', error: { type: 'not_found_error', message: `model: ${id}` } }, { status: 404 });
        return Response.json({ type: 'model', id: model.id, display_name: model.id, ...(model.metadata ?? {}) });
      }
      if (request.method === 'GET' && path === '/api/tags') {
        record('models');
        return Response.json({ models: models.map((model) => ({ name: model.id, model: model.id })) });
      }
      if (request.method === 'POST' && path === '/api/show') {
        record('models');
        const model = models.find((entry) => entry.id === body?.model || entry.id === body?.name);
        if (!model) return Response.json({ error: `model "${body?.model}" not found` }, { status: 404 });
        return Response.json({
          model_info: { 'general.architecture': 'fake', ...(model.contextLength ? { 'fake.context_length': model.contextLength } : {}) },
          capabilities: model.capabilities ?? ['completion'],
        });
      }
      return new Response('not found', { status: 404 });
    },
  });

  const url = `http://127.0.0.1:${server.port}`;
  return {
    url,
    openaiBaseUrl: `${url}/v1`,
    anthropicBaseUrl: url,
    ollamaBaseUrl: url,
    requests,
    completions: () => requests.filter((request) => request.dialect !== 'models'),
    enqueue: (...turns: ScriptedTurn[]) => {
      queue.push(...turns);
    },
    pending: () => queue.length,
    close: () => {
      server.stop(true);
    },
  };
}
