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
