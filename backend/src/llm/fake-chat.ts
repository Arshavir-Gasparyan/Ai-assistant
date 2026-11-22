import { AppError } from '../errors.js';
import type { ChatModel } from './chat-model.js';

const STOPWORDS = new Set(
  'the and for are can how many much what when where which who why does did is was were with from that this have has you your our not any all per'.split(' '),
);
const words = (s: string) =>
  new Set((s.toLowerCase().match(/\p{L}{3,}/gu) ?? []).filter((w) => !STOPWORDS.has(w)));

/**
 * A deterministic stand-in for an LLM, for tests and for trying the app without a key.
 * It is NOT intelligent: it picks the source sharing the most words with the question
 * and returns that source's first sentence with a citation. No shared words = refuse.
 *
 * It reads the tags of OUR prompts, so it only works with them. It picks its behaviour by
 * `schemaName`: rag_answer (above), condense_question (a short follow-up is glued onto the
 * previous question), conversation_summary (lists the user's questions).
 *
 * Streaming: it sends its JSON in small pieces, like a real model. `delayMs` between pieces
 * makes the streaming visible in the UI (0 in tests).
 */
export function createFakeChatModel(model = 'fake-extractive-v1', delayMs = 0): ChatModel {
  return {
    provider: 'fake',
    model,
    async completeJson({ messages, schemaName }, { onToken, signal } = {}) {
      const user = messages.find((m) => m.role === 'user')?.content ?? '';
      const tokens = (out: unknown) => ({ inputTokens: Math.ceil(user.length / 4), outputTokens: Math.ceil(JSON.stringify(out).length / 4) });

      if (schemaName === 'condense_question') {
        const latest = /<latest_message>\n([\s\S]*?)\n<\/latest_message>/.exec(user)?.[1] ?? '';
        const previous = [...user.matchAll(/<message role="user">\n([\s\S]*?)\n<\/message>/g)].at(-1)?.[1];
        const isShortFollowUp = latest.split(/\s+/).length <= 7;
        const json = { standaloneQuestion: previous && isShortFollowUp ? `${previous} ${latest}` : latest };
        return { json, usage: tokens(json) };
      }
      if (schemaName === 'conversation_summary') {
        const questions = [...user.matchAll(/<message role="user">\n([\s\S]*?)\n<\/message>/g)].map((m) => m[1]);
        const json = { summary: `The user asked: ${questions.join(' | ')}` };
        return { json, usage: tokens(json) };
      }

      const question = words(/<question>([\s\S]*?)<\/question>/.exec(user)?.[1] ?? '');
      // The opening tag ends at the newline (headings like "Leave > Vacation" contain ">").
      const sources = [...user.matchAll(/<source id="(\d+)"[^\n]*\n([\s\S]*?)\n<\/source>/g)].map((m) => ({
        n: Number(m[1]),
        text: m[2]!.trim(),
      }));

      let best: { n: number; text: string; overlap: number } | null = null;
      for (const s of sources) {
        const overlap = [...words(s.text)].filter((w) => question.has(w)).length;
        if (overlap > 0 && (!best || overlap > best.overlap)) best = { ...s, overlap };
      }

      let json: { answerable: boolean; answer: string; citations: number[] };
      if (!best) {
        json = { answerable: false, answer: '', citations: [] };
      } else {
        const firstSentence = (best.text.split(/(?<=[.!?])\s/)[0] ?? best.text).slice(0, 300);
        json = { answerable: true, answer: `${firstSentence} [${best.n}]`, citations: [best.n] };
      }

      const text = JSON.stringify(json);
      if (onToken) {
        for (let i = 0; i < text.length; i += 6) {
          if (signal?.aborted) throw new AppError(499, 'CLIENT_CLOSED_REQUEST', 'The request was cancelled');
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
          onToken(text.slice(i, i + 6));
        }
      }
      return { json, usage: { inputTokens: Math.ceil(user.length / 4), outputTokens: Math.ceil(text.length / 4) } };
    },
  };
}
