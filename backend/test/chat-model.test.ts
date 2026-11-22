import { describe, expect, it, vi } from 'vitest';
import { createChatModel } from '../src/llm/index.js';
import { createOpenAIChatModel } from '../src/llm/openai-chat.js';
import { estimateCostUsd } from '../src/llm/usage.js';
import { createLogger } from '../src/logger.js';

const silent = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });

const REQUEST = {
  messages: [
    { role: 'system' as const, content: 'rules' },
    { role: 'user' as const, content: 'secret document text' },
  ],
  schemaName: 'rag_answer',
  jsonSchema: { type: 'object' },
  maxOutputTokens: 600,
};

/** A fake `fetch` that plays the OpenAI Chat Completions endpoint. */
function fakeOpenAI(reply: { content?: string | null; finish_reason?: string; refusal?: string | null; status?: number }) {
  return vi.fn(async () => {
    if (reply.status && reply.status >= 400) {
      return Response.json(
        { error: { message: 'Incorrect API key provided: sk-abc***xyz', type: 'invalid_request_error', code: 'invalid_api_key' } },
        { status: reply.status },
      );
    }
    return Response.json({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-4.1-mini-2025-04-14',
      choices: [
        {
          index: 0,
          finish_reason: reply.finish_reason ?? 'stop',
          message: { role: 'assistant', content: reply.content ?? null, refusal: reply.refusal ?? null },
        },
      ],
      usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
    });
  });
}

const make = (fetch: ReturnType<typeof fakeOpenAI>, model = 'gpt-4.1-mini', log = silent) =>
  createOpenAIChatModel('sk-test-0000000000000000000000', model, log, { fetch, maxRetries: 0 });

const sentBody = (fetch: ReturnType<typeof fakeOpenAI>) =>
  JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));

describe('OpenAI chat model (mocked HTTP)', () => {
  it('requests strict JSON-schema output with temperature 0 and a token cap', async () => {
    const fetch = fakeOpenAI({ content: '{"ok":true}' });
    const result = await make(fetch).completeJson(REQUEST);

    expect(result).toEqual({ json: { ok: true }, usage: { inputTokens: 1000, outputTokens: 100 } });
    expect(sentBody(fetch)).toMatchObject({
      model: 'gpt-4.1-mini',
      temperature: 0,
      max_completion_tokens: 600,
      response_format: { type: 'json_schema', json_schema: { name: 'rag_answer', strict: true, schema: { type: 'object' } } },
    });
  });

  it('does not send temperature to reasoning models', async () => {
    const fetch = fakeOpenAI({ content: '{}' });
    await make(fetch, 'gpt-5-mini').completeJson(REQUEST);
    expect(sentBody(fetch)).not.toHaveProperty('temperature');
  });

  it('logs model, tokens, latency and cost, but never the prompt', async () => {
    const info = vi.fn();
    const log = { ...silent, info, child: () => log } as unknown as typeof silent;
    await make(fakeOpenAI({ content: '{}' }), 'gpt-4.1-mini', log).completeJson(REQUEST);

    const [fields, msg] = info.mock.calls[0]!;
    expect(msg).toBe('LLM call');
    expect(fields.llm).toMatchObject({ provider: 'openai', model: 'gpt-4.1-mini', operation: 'chat', inputTokens: 1000, outputTokens: 100 });
    expect(fields.llm.costUsd).toBeCloseTo(estimateCostUsd('gpt-4.1-mini', 1000, 100)!);
    expect(JSON.stringify(info.mock.calls)).not.toContain('secret document text');
  });

  it('turns provider errors into a generic 502 and never logs the key fragment', async () => {
    const error = vi.fn();
    const log = { ...silent, error, child: () => log } as unknown as typeof silent;
    await expect(make(fakeOpenAI({ status: 401 }), 'gpt-4.1-mini', log).completeJson(REQUEST)).rejects.toMatchObject({
      statusCode: 502,
      code: 'CHAT_FAILED',
    });
    expect(error.mock.calls[0]![0]).toEqual({ status: 401, code: 'invalid_api_key', type: 'invalid_request_error' });
    expect(JSON.stringify(error.mock.calls)).not.toContain('sk-abc');
  });

  it.each([
    ['cut off at the token limit', { content: '{"answer":"tru', finish_reason: 'length' }],
    ['a provider safety refusal', { content: null, refusal: 'I cannot help with that.' }],
    ['empty content', { content: '' }],
    ['invalid JSON', { content: 'not json' }],
  ])('502 CHAT_INVALID_RESPONSE for %s', async (_name, reply) => {
    await expect(make(fakeOpenAI(reply)).completeJson(REQUEST)).rejects.toMatchObject({
      statusCode: 502,
      code: 'CHAT_INVALID_RESPONSE',
    });
  });
});

describe('createChatModel', () => {
  it('fake provider needs no key', () => {
    expect(createChatModel({ CHAT_PROVIDER: 'fake', CHAT_MODEL: 'gpt-4.1-mini', OPENAI_API_KEY: undefined }, silent).provider).toBe('fake');
  });

  it('uses OpenAI with the configured model when a key is set', () => {
    const m = createChatModel({ CHAT_PROVIDER: 'openai', CHAT_MODEL: 'gpt-5-mini', OPENAI_API_KEY: 'sk-test-0000000000000000000000' }, silent);
    expect(m).toMatchObject({ provider: 'openai', model: 'gpt-5-mini' });
  });

  it('without a key: boots, but completions fail with 503 CHAT_NOT_CONFIGURED', async () => {
    const m = createChatModel({ CHAT_PROVIDER: 'openai', CHAT_MODEL: 'gpt-4.1-mini', OPENAI_API_KEY: undefined }, silent);
    await expect(m.completeJson(REQUEST)).rejects.toMatchObject({ statusCode: 503, code: 'CHAT_NOT_CONFIGURED' });
  });
});

describe('chat pricing', () => {
  it('prices input and output tokens separately', () => {
    expect(estimateCostUsd('gpt-4.1-mini', 1_000_000, 1_000_000)).toBeCloseTo(0.4 + 1.6);
  });
});

describe('OpenAI chat model streaming (mocked SSE)', () => {
  /** What OpenAI sends for stream: true: one `data: {chunk}` line per piece, then [DONE]. */
  function sseResponse(pieces: string[], opts: { finish?: string; usage?: boolean } = {}) {
    const chunk = (delta: object, finish: string | null = null) => ({
      id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4.1-mini',
      choices: [{ index: 0, delta, finish_reason: finish }],
    });
    const events = [
      chunk({ role: 'assistant', content: '' }),
      ...pieces.map((p) => chunk({ content: p })),
      chunk({}, opts.finish ?? 'stop'),
      ...(opts.usage === false ? [] : [{ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gpt-4.1-mini', choices: [], usage: { prompt_tokens: 900, completion_tokens: 30, total_tokens: 930 } }]),
    ];
    const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }

  const PIECES = ['{"answerable":tr', 'ue,"answer":"Five', ' days [1]","citations":[1]}'];

  it('requests a stream with usage, forwards each piece, and returns the parsed JSON', async () => {
    const fetch = vi.fn(async () => sseResponse(PIECES));
    const tokens: string[] = [];
    const result = await make(fetch as never).completeJson(REQUEST, { onToken: (t) => tokens.push(t) });

    expect(tokens).toEqual(PIECES);
    expect(result).toEqual({
      json: { answerable: true, answer: 'Five days [1]', citations: [1] },
      usage: { inputTokens: 900, outputTokens: 30 },
    });
    expect(sentBody(fetch as never)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it('logs time to first token for streamed calls', async () => {
    const info = vi.fn();
    const log = { ...silent, info, child: () => log } as unknown as typeof silent;
    await make(vi.fn(async () => sseResponse(PIECES)) as never, 'gpt-4.1-mini', log).completeJson(REQUEST, { onToken: () => {} });
    const llm = info.mock.calls.find(([, msg]) => msg === 'LLM call')![0].llm;
    expect(llm).toMatchObject({ streamed: true, inputTokens: 900, outputTokens: 30 });
    expect(llm.timeToFirstTokenMs).toBeTypeOf('number');
  });

  it('a stream cut off by the token limit is rejected', async () => {
    const fetch = vi.fn(async () => sseResponse(['{"answer":"Five'], { finish: 'length' }));
    await expect(make(fetch as never).completeJson(REQUEST, { onToken: () => {} })).rejects.toMatchObject({
      code: 'CHAT_INVALID_RESPONSE',
    });
  });

  it('an aborted request becomes CLIENT_CLOSED_REQUEST, not a provider error', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return sseResponse(PIECES);
    });
    await expect(
      make(fetch as never).completeJson(REQUEST, { onToken: () => {}, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CLIENT_CLOSED_REQUEST' });
  });
});
