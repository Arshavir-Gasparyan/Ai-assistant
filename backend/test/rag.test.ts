import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { ChatModel } from '../src/llm/chat-model.js';
import { createFakeChatModel } from '../src/llm/fake-chat.js';
import { createLogger } from '../src/logger.js';
import { answerQuestion, REFUSAL_MESSAGE, type ChatStreamEvent } from '../src/rag/answer.js';
import { resolveCitations } from '../src/rag/citations.js';
import type { SearchResponse, SearchResult } from '../src/search/search.js';
import { fakeDeps, testEnv } from './helpers.js';

const silent = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });

const chunk = (i: number, content: string, heading = `Section ${i}`): SearchResult => ({
  chunkId: `00000000-0000-4000-8000-00000000000${i}`,
  documentId: '00000000-0000-4000-8000-0000000000aa',
  filename: 'handbook.md',
  heading,
  pageNumber: null,
  content,
  score: 0.03,
  ranks: { vector: i, keyword: i },
  similarity: 0.5,
});

const SOURCES = [
  chunk(1, 'Full-time employees receive 25 days of paid vacation per year.', 'Leave > Vacation'),
  chunk(2, 'Up to 5 unused vacation days can be carried over.', 'Leave > Carry-over'),
];

const retrieveReturning = (results: SearchResult[], extra: Partial<SearchResponse> = {}) =>
  vi.fn(async () => ({ modeUsed: 'hybrid' as const, results, warnings: [], ...extra }));

/** A chat model that returns whatever JSON the test wants. */
const modelReturning = (json: unknown): ChatModel & { completeJson: ReturnType<typeof vi.fn> } => ({
  provider: 'fake',
  model: 'scripted',
  completeJson: vi.fn(async () => ({ json, usage: { inputTokens: 1, outputTokens: 1 } })),
});

describe('resolveCitations', () => {
  it('keeps valid markers in order of first appearance', () => {
    expect(resolveCitations('A [2]. B [1][2].', 3)).toEqual({ text: 'A [2]. B [1][2].', cited: [2, 1] });
  });

  it('removes markers that point to non-existent sources', () => {
    expect(resolveCitations('A [1]. B [7]. C [0].', 2)).toEqual({ text: 'A [1]. B. C.', cited: [1] });
  });

  it('returns no citations when the answer has no markers', () => {
    expect(resolveCitations('Just an opinion.', 5).cited).toEqual([]);
  });
});

describe('answerQuestion (RAG pipeline)', () => {
  it('answers with citations mapped to the retrieved chunks', async () => {
    const chatModel = modelReturning({ answerable: true, answer: 'You can carry over 5 days [2].', citations: [2] });
    const res = await answerQuestion({ retrieve: retrieveReturning(SOURCES), chatModel, log: silent }, 'carry over?', 5);

    expect(res).toMatchObject({
      answer: 'You can carry over 5 days [2].',
      answerable: true,
      refusalReason: null,
      promptVersion: 'rag-answer@v1',
      model: 'scripted',
      retrieval: { modeUsed: 'hybrid', sources: 2 },
    });
    expect(res.citations).toEqual([
      expect.objectContaining({ n: 2, chunkId: SOURCES[1]!.chunkId, heading: 'Leave > Carry-over' }),
    ]);
  });

  it('sends the versioned prompt and a JSON schema to the model', async () => {
    const chatModel = modelReturning({ answerable: true, answer: 'x [1]', citations: [1] });
    await answerQuestion({ retrieve: retrieveReturning(SOURCES), chatModel, log: silent }, 'q', 5);
    const request = chatModel.completeJson.mock.calls[0]![0];
    expect(request.messages[1].content).toContain('<source id="2"');
    expect(request.schemaName).toBe('rag_answer');
    expect(request.jsonSchema.required).toEqual(['answerable', 'answer', 'citations']);
    expect(request.maxOutputTokens).toBeGreaterThan(0);
  });

  it('refuses WITHOUT calling the LLM when retrieval finds nothing', async () => {
    const chatModel = modelReturning({});
    const res = await answerQuestion({ retrieve: retrieveReturning([]), chatModel, log: silent }, 'q', 5);
    expect(res).toMatchObject({ answer: REFUSAL_MESSAGE, answerable: false, refusalReason: 'no_sources', citations: [] });
    expect(chatModel.completeJson).not.toHaveBeenCalled();
  });

  it('refuses when the model says the sources do not contain the answer', async () => {
    const chatModel = modelReturning({ answerable: false, answer: '', citations: [] });
    const res = await answerQuestion({ retrieve: retrieveReturning(SOURCES), chatModel, log: silent }, 'CEO salary?', 5);
    expect(res).toMatchObject({ answer: REFUSAL_MESSAGE, refusalReason: 'not_in_sources' });
  });

  it('refuses an answer that cites no real source (grounding check)', async () => {
    const chatModel = modelReturning({ answerable: true, answer: 'Probably 30 days [9].', citations: [9] });
    const res = await answerQuestion({ retrieve: retrieveReturning(SOURCES), chatModel, log: silent }, 'q', 5);
    expect(res).toMatchObject({ answerable: false, refusalReason: 'no_valid_citations', citations: [] });
  });

  it('throws 502 when the model returns JSON of the wrong shape', async () => {
    const chatModel = modelReturning({ text: 'hello' });
    await expect(
      answerQuestion({ retrieve: retrieveReturning(SOURCES), chatModel, log: silent }, 'q', 5),
    ).rejects.toMatchObject({ statusCode: 502, code: 'CHAT_INVALID_RESPONSE' });
  });

  it('passes retrieval warnings through (e.g. keyword-only fallback)', async () => {
    const chatModel = modelReturning({ answerable: true, answer: 'x [1]', citations: [1] });
    const retrieve = retrieveReturning(SOURCES, { modeUsed: 'keyword', warnings: ['keyword only'] });
    const res = await answerQuestion({ retrieve, chatModel, log: silent }, 'q', 5);
    expect(res.retrieval.modeUsed).toBe('keyword');
    expect(res.warnings).toEqual(['keyword only']);
  });

  it('never logs the question or the answer', async () => {
    const info = vi.fn();
    const log = { ...silent, info, child: () => log } as unknown as typeof silent;
    const chatModel = modelReturning({ answerable: true, answer: 'Secret answer [1]', citations: [1] });
    await answerQuestion({ retrieve: retrieveReturning(SOURCES), chatModel, log }, 'my private question', 5);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ rag: expect.any(Object) }), 'RAG answer');
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/private question|Secret answer/);
  });
});

describe('answerQuestion with streaming', () => {
  const ask = async (question: string, sources = SOURCES) => {
    const events: ChatStreamEvent[] = [];
    const final = await answerQuestion(
      { retrieve: retrieveReturning(sources), chatModel: createFakeChatModel(), log: silent },
      question,
      5,
      { onEvent: (e) => events.push(e) },
    );
    return { events, final };
  };

  it('sends meta first, then answer deltas that add up to the final answer', async () => {
    const { events, final } = await ask('How many unused vacation days can be carried over?');
    expect(events[0]).toEqual({
      type: 'meta',
      model: 'fake-extractive-v1',
      promptVersion: 'rag-answer@v1',
      retrieval: { modeUsed: 'hybrid', sources: 2 },
      warnings: [],
    });
    const deltas = events.slice(1);
    expect(deltas.length).toBeGreaterThan(3); // really streamed in pieces
    expect(deltas.every((e) => e.type === 'delta')).toBe(true);
    expect(deltas.map((e) => (e.type === 'delta' ? e.text : '')).join('')).toBe(final.answer);
  });

  it('a refusal streams meta only: no deltas, the final answer carries the refusal', async () => {
    const { events, final } = await ask('Who is the CEO?');
    expect(events.map((e) => e.type)).toEqual(['meta']);
    expect(final.refusalReason).toBe('not_in_sources');
  });

  it('no sources: meta only and no LLM call', async () => {
    const { events, final } = await ask('anything', []);
    expect(events.map((e) => e.type)).toEqual(['meta']);
    expect(final.refusalReason).toBe('no_sources');
  });

  it('stops when the signal is aborted (client went away)', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      answerQuestion(
        { retrieve: retrieveReturning(SOURCES), chatModel: createFakeChatModel(), log: silent },
        'vacation days carried over',
        5,
        { onEvent: () => {}, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'CLIENT_CLOSED_REQUEST' });
  });
});

describe('fake chat model', () => {
  const run = (question: string) =>
    answerQuestion(
      { retrieve: retrieveReturning(SOURCES), chatModel: createFakeChatModel(), log: silent },
      question,
      5,
    );

  it('answers from the source sharing the most words, with a citation', async () => {
    const res = await run('How many unused vacation days can be carried over?');
    expect(res.answer).toBe('Up to 5 unused vacation days can be carried over. [2]');
    expect(res.citations[0]!.n).toBe(2);
  });

  it('refuses when no source shares a word with the question', async () => {
    expect((await run('Who is the CEO?')).refusalReason).toBe('not_in_sources');
  });
});

describe('POST /chat and /chat/stream validation', () => {
  const app = buildApp(testEnv(), fakeDeps());
  it.each([
    ['missing question', {}],
    ['empty question', { question: '  ' }],
    ['question over 1000 chars', { question: 'a'.repeat(1001) }],
    ['topK over 10', { question: 'q', topK: 11 }],
  ])('400 for %s', async (_name, payload) => {
    for (const url of ['/chat', '/chat/stream']) {
      const res = await app.inject({ method: 'POST', url, payload });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
  });
});
