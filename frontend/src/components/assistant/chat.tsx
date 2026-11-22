'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, streamChat } from '@/lib/api';
import { AssistantMessage, type AssistantMessageData } from './assistant-message';

type Message = { id: string; role: 'user'; text: string } | ({ role: 'assistant' } & AssistantMessageData);

const EXAMPLES = [
  'How many vacation days can I carry over?',
  'How long must passwords be?',
  'What should I do if I lose my laptop?',
];

let nextId = 0;
const newId = () => `m${++nextId}`;

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest text in view while it streams in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  // Leaving the page cancels an in-flight answer (and the backend stops the LLM call).
  useEffect(() => () => abortRef.current?.abort(), []);

  const updateAssistant = (id: string, patch: (m: AssistantMessageData) => Partial<AssistantMessageData>) =>
    setMessages((prev) => prev.map((m) => (m.id === id && m.role === 'assistant' ? { ...m, ...patch(m) } : m)));

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    const assistantId = newId();
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: 'user', text: q },
      { id: assistantId, role: 'assistant', status: 'retrieving', text: '' },
    ]);
    setDraft('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        { question: q },
        {
          onMeta: (meta) => updateAssistant(assistantId, () => ({ meta, status: 'streaming' })),
          onDelta: (text) => updateAssistant(assistantId, (m) => ({ text: m.text + text })),
          onDone: (answer) => updateAssistant(assistantId, () => ({ answer, status: 'done' })),
        },
        controller.signal,
      );
    } catch (err) {
      if (controller.signal.aborted) {
        updateAssistant(assistantId, () => ({ status: 'stopped' }));
      } else {
        const message = err instanceof ApiError ? err.message : 'Something went wrong';
        updateAssistant(assistantId, () => ({ status: 'error', error: message }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm dark:border-zinc-700">
          <p className="mb-3 text-zinc-500">
            Answers come only from your uploaded documents, with numbered citations. Each question is answered on
            its own for now (conversation memory arrives in Milestone 10).
          </p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                onClick={() => void ask(e)}
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className="self-end rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
            {m.text}
          </div>
        ) : (
          <AssistantMessage key={m.id} message={m} />
        ),
      )}
      <div ref={bottomRef} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
        className="sticky bottom-4 flex gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter adds a new line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(draft);
            }
          }}
          rows={1}
          maxLength={1000}
          placeholder="Ask a question about your documents…"
          aria-label="Question"
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm font-medium dark:border-zinc-700"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Ask
          </button>
        )}
      </form>
    </div>
  );
}
