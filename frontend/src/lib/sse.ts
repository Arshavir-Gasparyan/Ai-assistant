/**
 * Reads a Server-Sent Events stream from a fetch() Response.
 *
 * Why not the browser's EventSource? It only supports GET (no request body), and we POST
 * the question. The wire format is simple enough to parse ourselves:
 *
 *   event: delta\n
 *   data: {"text":"Up to 5"}\n
 *   \n                          ← a blank line ends one event
 *   : ping\n\n                  ← lines starting with ":" are comments (heartbeats)
 */
export interface SseEvent {
  event: string;
  data: string;
}

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  // { stream: true } makes the decoder hold back an incomplete multi-byte character
  // (é, ✓, emoji) whose bytes are split across two network chunks, instead of garbling it.
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Network chunks don't line up with events: process complete events only and keep
      // the unfinished tail in the buffer for the next read.
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith(':')) continue; // comment / heartbeat
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length > 0) yield { event, data: data.join('\n') };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
