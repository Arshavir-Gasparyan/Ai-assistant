# Learning notes

One file per milestone, in your own words. Writing the explanation yourself is the
best preparation for presenting the project.

Suggested format per note:
- **What I built**
- **The concept, explained simply**
- **Why this design (and what the alternatives were)**
- **How to demo it**
- **Questions I still have**

| Milestone | Note |
|-----------|------|
| 1 | [01-repository-setup.md](01-repository-setup.md) |

## Frontend patterns used (Dashboard and Search UI)

- **Server page, client feature:** `page.tsx` stays a Server Component and renders a Client
  Component that calls the API from the browser (ADR-0002).
- **URL as state:** the Search page keeps `q`, `mode` and `topK` in the query string, so results
  are shareable and the back button works. `useSearchParams` needs a `<Suspense>` boundary with
  Cache Components.
- **Derived loading state:** results remember which request they belong to, so "loading" is
  computed (`result.key !== currentKey`) instead of a `setState` inside `useEffect`
  (the `react-hooks/set-state-in-effect` lint rule).
- **AbortController** cancels the previous request when the query or the selected document changes.

## Streaming (Milestone 9)

- **TTFT (time to first token)** is the latency users feel. Streaming doesn't make the answer faster,
  it makes it *start* sooner. It's logged as `timeToFirstTokenMs` on every streamed LLM call.
- **SSE** = a normal HTTP response that stays open, with `event:`/`data:` blocks separated by blank lines.
- **Streaming structured output:** the model streams JSON, so we parse the `answer` field incrementally.
  Anything verified (citations, grounding) can only be checked at the end, so `delta` is a preview
  and `done` is the truth.
- **Cancellation:** closing the tab → the server sees the closed socket → `AbortController` →
  the provider request is cancelled → no more tokens billed.

## Conversation memory (Milestone 10)

- **LLMs are stateless.** "Memory" means re-sending earlier messages, which costs tokens every turn, so it must be bounded.
- **Sliding window + summary:** the last few messages verbatim, older ones compressed into a summary by the LLM.
- **Query rewriting (condensing)** matters more for RAG than putting history in the prompt: search needs
  "How many vacation days can be carried over?", not "and how many can I carry over?".
- **Token budgets:** a prompt budget (what fits in one request) and a spending budget (what one
  conversation may cost). Estimate with chars/4 and measure with the provider's `usage`.
- **Redis TTL as a retention policy:** conversation text may contain personal data, so it expires.
