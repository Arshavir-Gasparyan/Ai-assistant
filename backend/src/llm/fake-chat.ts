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
 * It reads the <source>/<question> tags of the RAG prompt, so it only works with that prompt.
 */
export function createFakeChatModel(model = 'fake-extractive-v1'): ChatModel {
  return {
    provider: 'fake',
    model,
    async completeJson({ messages }) {
      const user = messages.find((m) => m.role === 'user')?.content ?? '';
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

      const usage = { inputTokens: Math.ceil(user.length / 4), outputTokens: 0 };
      if (!best) return { json: { answerable: false, answer: '', citations: [] }, usage };

      const firstSentence = (best.text.split(/(?<=[.!?])\s/)[0] ?? best.text).slice(0, 300);
      const answer = `${firstSentence} [${best.n}]`;
      return {
        json: { answerable: true, answer, citations: [best.n] },
        usage: { ...usage, outputTokens: Math.ceil(answer.length / 4) },
      };
    },
  };
}
